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

const checkInput = {
  owner: 'acme', repo: 'project', name: 'Security review', head_sha: 'a'.repeat(40),
  status: 'completed', conclusion: 'success', details_url: 'https://example.com/runs/321',
  output: { title: 'Review complete', summary: 'No confirmed findings.', text: 'Evidence retained in run 321.' },
}
const reviewInput = {
  owner: 'acme', repo: 'project', pull_number: 42, commit_id: 'a'.repeat(40),
  event: 'REQUEST_CHANGES', body: 'Two findings need attention.',
  comments: [
    { path: 'src/worker.ts', line: 12, side: 'RIGHT', body: 'Retain the failed attempt cost.' },
    { path: 'src/worker.ts', line: 28, side: 'LEFT', start_line: 25, start_side: 'LEFT', body: 'Keep this recovery path until its replacement is adopted.' },
  ],
}

it.each<{
  action: string
  input: Record<string, unknown>
  changedInput: Record<string, unknown>
  path: string
  response: Record<string, unknown>
  consistencyModel?: 'advisory'
}>([
  {
    action: 'checks.create', input: checkInput, changedInput: { ...checkInput, head_sha: 'b'.repeat(40) },
    path: '/repos/acme/project/check-runs', response: { id: 321, status: 'completed', conclusion: 'success' },
    consistencyModel: 'advisory',
  },
  {
    action: 'pulls.reviews.create', input: reviewInput,
    changedInput: { ...reviewInput, comments: [{ ...reviewInput.comments[0], body: 'A changed finding requires its own approval.' }] },
    path: '/repos/acme/project/pulls/42/reviews', response: { id: 777, state: 'CHANGES_REQUESTED' },
  },
])('keeps GitHub $action behind approval and posts the approved payload over HTTP', async ({ action, input, changedInput, path, response: providerResponse, consistencyModel }) => {
  const received: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
  const peer = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    received.push({ method: request.method!, path: request.url!, body: JSON.parse(Buffer.concat(chunks).toString()) })
    response.writeHead(201, { 'content-type': 'application/json' })
    response.end(JSON.stringify(providerResponse))
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
        defaultDestructiveEffect: 'require_approval',
      }),
    }),
  })
  const catalog = await provider.listConnectors()
  const advertised = catalog[0].actions.find(candidate => candidate.id === action)
  expect(advertised).toMatchObject({
    risk: 'destructive', approvalRequired: true,
    ...(consistencyModel ? { consistencyModel } : {}),
  })
  if (action === 'pulls.reviews.create') {
    expect(advertised?.inputSchema).toMatchObject({
      properties: {
        commit_id: { type: 'string' },
        comments: { type: 'array', items: {
          type: 'object', required: ['path', 'line', 'body'],
          properties: {
            path: { type: 'string' }, line: { type: 'integer' }, body: { type: 'string' },
            side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
            start_line: { type: 'integer' }, start_side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
          },
        } },
      },
    })
  }
  const capability = await hub.issueCapability({
    subject, connectionId: connection.id, scopes: [], allowedActions: [action], ttlMs: 60_000,
  })
  const invoke = (key: string, args = input, approvalId?: string) => hub.invokeWithCapability(capability.token, {
    action, input: args, idempotencyKey: key,
    ...(approvalId ? { metadata: { approvalId } } : {}),
  })
  const blocked = await invoke('before-approval')
  expect(blocked).toMatchObject({ ok: false, output: { approvalRequired: true } })
  expect(received).toEqual([])
  const pending = approvals.list({ status: 'pending' })[0]
  await resolveIntegrationApproval({ store: approvals, approvalId: pending.id, approved: true, resolvedBy: owner })
  const committed = await invoke('approved', input, pending.id)
  expect(committed).toMatchObject({ ok: true })
  expect(committed.output).toMatchObject(providerResponse)
  expect(received).toHaveLength(1)
  expect(received[0]).toMatchObject({ method: 'POST', path, body: input })
  const changed = await invoke('changed', changedInput, pending.id)
  expect(changed).toMatchObject({ ok: false, output: { approvalRequired: true } })
  expect(received).toHaveLength(1)
  const denied = approvals.list({ status: 'pending' })[0]
  await resolveIntegrationApproval({ store: approvals, approvalId: denied.id, approved: false, resolvedBy: owner })
  expect(await invoke('denied', changedInput, denied.id)).toMatchObject({ ok: false, output: { approvalRequired: true } })
  expect((await approvals.get(denied.id))?.status).toBe('denied')
  expect(received).toHaveLength(1)
  await expect(githubConnector.executeRead!({
    source: { id: connection.id, projectId: 'checks', publishedAgentId: null, kind: 'github', label: 'GitHub App',
      consistencyModel: 'authoritative', scopes: [], metadata: {}, status: 'active', credentials: { kind: 'api-key', apiKey: 'fixture-token' } },
    capabilityName: action, args: input, idempotencyKey: 'read-refused',
  })).rejects.toThrow()
  expect(received).toHaveLength(1)
})
