import { createServer } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import {
  ApprovalBackedPolicyEngine,
  InMemoryConnectionStore,
  InMemoryIntegrationApprovalStore,
  IntegrationHub,
  createConnectorAdapterProvider,
  createDefaultIntegrationPolicyEngine,
  githubConnector,
  resolveIntegrationApproval,
} from '../src/index.js'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

it('keeps GitHub check creation behind approval and posts the approved payload over HTTP', async () => {
  const received: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
  const peer = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    received.push({ method: request.method!, path: request.url!, body: JSON.parse(Buffer.concat(chunks).toString()) })
    response.writeHead(201, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ id: 321, status: 'completed', conclusion: 'success' }))
  })
  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => peer.close(error => error ? reject(error) : resolve())))
  const address = peer.address()
  if (!address || typeof address === 'string') throw new Error('HTTP peer did not bind')
  const networkFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input))
    if (url.origin !== 'https://api.github.com') throw new Error('Unexpected provider origin')
    return networkFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init)
  }
  cleanups.push(() => { globalThis.fetch = networkFetch })
  const owner = { type: 'user' as const, id: 'checks-owner' }
  const subject = { type: 'sandbox' as const, id: 'checks-agent' }
  const connections = new InMemoryConnectionStore()
  const approvals = new InMemoryIntegrationApprovalStore()
  const connection = {
    id: 'github-installation', owner, providerId: 'first-party', connectorId: 'github',
    status: 'active' as const, grantedScopes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  await connections.put(connection)
  const provider = createConnectorAdapterProvider({
    adapters: [githubConnector],
    resolveDataSource: () => ({
      id: connection.id, projectId: 'checks', publishedAgentId: null, kind: 'github', label: 'GitHub App',
      consistencyModel: 'authoritative', scopes: [], metadata: {}, status: 'active',
      credentials: { kind: 'api-key', apiKey: 'installation-fixture-token' },
    }),
  })
  const hub = new IntegrationHub({
    store: connections, providers: [provider], capabilitySecret: 'local-checks-capability-secret',
    policy: new ApprovalBackedPolicyEngine({
      store: approvals,
      base: createDefaultIntegrationPolicyEngine({
        rules: [{ id: 'approve-checks', connectorId: 'github', action: 'checks.create', effect: 'require_approval', reason: 'Owner approves the published check.' }],
      }),
    }),
  })
  const catalog = await provider.listConnectors()
  expect(catalog[0].actions.find(action => action.id === 'checks.create')).toMatchObject({
    risk: 'destructive', approvalRequired: true,
  })
  const capability = await hub.issueCapability({
    subject, connectionId: connection.id, scopes: [], allowedActions: ['checks.create'], ttlMs: 60_000,
  })
  const input = {
    owner: 'acme', repo: 'project', name: 'Security review', head_sha: 'a'.repeat(40),
    status: 'completed', conclusion: 'success', details_url: 'https://example.com/runs/321',
    output: { title: 'Review complete', summary: 'No confirmed findings.', text: 'Evidence retained in run 321.' },
  }
  const invoke = (key: string, args = input, approvalId?: string) => hub.invokeWithCapability(capability.token, {
    action: 'checks.create', input: args, idempotencyKey: key,
    ...(approvalId ? { metadata: { approvalId } } : {}),
  })
  const blocked = await invoke('before-approval')
  expect(blocked).toMatchObject({ ok: false, output: { approvalRequired: true } })
  expect(received).toEqual([])
  const pending = approvals.list({ status: 'pending' })[0]
  await resolveIntegrationApproval({ store: approvals, approvalId: pending.id, approved: true, resolvedBy: owner })
  const committed = await invoke('approved', input, pending.id)
  expect(committed).toMatchObject({ ok: true })
  expect(committed.output).toMatchObject({ id: 321, conclusion: 'success' })
  expect(received).toHaveLength(1)
  expect(received[0]).toMatchObject({ method: 'POST', path: '/repos/acme/project/check-runs', body: {
    name: input.name, head_sha: input.head_sha, output: input.output, conclusion: 'success',
  } })
  const changed = await invoke('changed', { ...input, head_sha: 'b'.repeat(40) }, pending.id)
  expect(changed).toMatchObject({ ok: false, output: { approvalRequired: true } })
  expect(received).toHaveLength(1)
  const denied = approvals.list({ status: 'pending' })[0]
  await resolveIntegrationApproval({ store: approvals, approvalId: denied.id, approved: false, resolvedBy: owner })
  expect(await invoke('denied', { ...input, head_sha: 'b'.repeat(40) }, denied.id)).toMatchObject({ ok: false, output: { approvalRequired: true } })
  expect((await approvals.get(denied.id))?.status).toBe('denied')
  expect(received).toHaveLength(1)
  await expect(githubConnector.executeRead!({
    source: { id: connection.id, projectId: 'checks', publishedAgentId: null, kind: 'github', label: 'GitHub App',
      consistencyModel: 'authoritative', scopes: [], metadata: {}, status: 'active', credentials: { kind: 'api-key', apiKey: 'fixture-token' } },
    capabilityName: 'checks.create', args: input, idempotencyKey: 'read-refused',
  })).rejects.toThrow()
  expect(received).toHaveLength(1)
})
