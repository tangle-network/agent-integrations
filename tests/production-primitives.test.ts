import { describe, expect, it } from 'vitest'
import {
  ApprovalBackedPolicyEngine,
  DefaultIntegrationActionGuard,
  InMemoryConnectionStore,
  InMemoryIntegrationApprovalStore,
  InMemoryIntegrationAuditStore,
  InMemoryIntegrationEventStore,
  InMemoryIntegrationGrantStore,
  InMemoryIntegrationHealthcheckStore,
  InMemoryIntegrationIdempotencyStore,
  InMemoryIntegrationSecretStore,
  IntegrationHub,
  buildIntegrationBridgeEnvironment,
  buildIntegrationInvocationEnvelope,
  buildIntegrationToolCatalog,
  createConnectionCredentialResolver,
  createConnectorAdapterProvider,
  createDefaultIntegrationPolicyEngine,
  createIntegrationRuntime,
  decodeIntegrationBridgePayload,
  dispatchIntegrationInvocation,
  parseIntegrationBridgeEnvironment,
  receiveIntegrationWebhook,
  resolveIntegrationApproval,
  runIntegrationHealthchecks,
  type ConnectorAdapter,
  type IntegrationConnection,
  type IntegrationManifest,
  type ResolvedDataSource,
} from '../src/index'

const owner = { type: 'user' as const, id: 'user_1' }
const sandbox = { type: 'sandbox' as const, id: 'sandbox_1' }

describe('production integration primitives', () => {
  it('persists approvals and resumes a write only for the approved subject/action/connection', async () => {
    const approvals = new InMemoryIntegrationApprovalStore()
    const audit = new InMemoryIntegrationAuditStore()
    const store = new InMemoryConnectionStore()
    const provider = createConnectorAdapterProvider({
      adapters: [notesAdapter],
      resolveDataSource: (connection) => sourceFor(connection.id),
    })
    const hub = new IntegrationHub({
      providers: [provider],
      store,
      capabilitySecret: 'secret',
      policy: new ApprovalBackedPolicyEngine({
        base: createDefaultIntegrationPolicyEngine({ now: () => new Date('2026-05-05T00:00:00.000Z') }),
        store: approvals,
        audit,
        now: () => new Date('2026-05-05T00:00:00.000Z'),
        approvalTtlMs: 60_000,
      }),
    })
    await store.put(activeConnection('conn_notes'))
    const capability = await hub.issueCapability({
      subject: sandbox,
      connectionId: 'conn_notes',
      scopes: [],
      allowedActions: ['notes.create'],
      ttlMs: 60_000,
    })

    const blocked = await hub.invokeWithCapability(capability.token, {
      action: 'notes.create',
      input: { title: 'Launch' },
      idempotencyKey: 'write-1',
    })
    const pending = approvals.list({ status: 'pending' })[0]
    await resolveIntegrationApproval({
      store: approvals,
      approvalId: pending.id,
      approved: true,
      resolvedBy: owner,
      audit,
      now: () => new Date('2026-05-05T00:00:01.000Z'),
    })
    const committed = await hub.invokeWithCapability(capability.token, {
      action: 'notes.create',
      input: { title: 'Launch' },
      idempotencyKey: 'write-2',
      metadata: { approvalId: pending.id },
    })
    const mismatched = await hub.invokeWithCapability(capability.token, {
      action: 'notes.create',
      input: { title: 'Different' },
      idempotencyKey: 'write-3',
      metadata: { approvalId: pending.id },
    })

    expect(blocked.ok).toBe(false)
    expect(committed.ok).toBe(true)
    expect(mismatched.ok).toBe(false)
    expect(audit.list({ type: 'approval.requested' })).toHaveLength(2)
    expect(audit.list({ type: 'approval.resolved' })).toHaveLength(1)
  })

  it('checks idempotency before approval policy for write retries', async () => {
    let mutations = 0
    const approvals = new InMemoryIntegrationApprovalStore()
    const audit = new InMemoryIntegrationAuditStore()
    const idempotency = new InMemoryIntegrationIdempotencyStore()
    const store = new InMemoryConnectionStore()
    const provider = createConnectorAdapterProvider({
      adapters: [{
        ...notesAdapter,
        async executeMutation(invocation) {
          mutations += 1
          return { status: 'committed', data: invocation.args, committedAt: 1, idempotentReplay: false }
        },
      }],
      resolveDataSource: (connection) => sourceFor(connection.id),
    })
    const hub = new IntegrationHub({
      providers: [provider],
      store,
      capabilitySecret: 'secret',
      guard: new DefaultIntegrationActionGuard({
        idempotency,
        requireIdempotencyForMutations: true,
      }),
      policy: new ApprovalBackedPolicyEngine({
        base: createDefaultIntegrationPolicyEngine({ now: () => new Date('2026-05-05T00:00:00.000Z') }),
        store: approvals,
        audit,
        now: () => new Date('2026-05-05T00:00:00.000Z'),
      }),
    })
    await store.put(activeConnection('conn_notes'))
    const capability = await hub.issueCapability({
      subject: sandbox,
      connectionId: 'conn_notes',
      scopes: [],
      allowedActions: ['notes.create'],
      ttlMs: 60_000,
    })

    const missingKey = await hub.invokeWithCapability(capability.token, {
      action: 'notes.create',
      input: { title: 'Launch' },
    })
    expect(missingKey).toMatchObject({
      ok: false,
      output: { idempotencyRequired: true },
    })
    expect(approvals.list()).toHaveLength(0)

    const blocked = await hub.invokeWithCapability(capability.token, {
      action: 'notes.create',
      input: { title: 'Launch' },
      idempotencyKey: 'write-idem',
    })
    expect(blocked).toMatchObject({
      ok: false,
      output: { approvalRequired: true },
    })
    expect(await idempotency.get('write-idem')).toBeUndefined()

    const approval = approvals.list({ status: 'pending' })[0]
    await resolveIntegrationApproval({
      store: approvals,
      approvalId: approval.id,
      approved: true,
      resolvedBy: owner,
      audit,
    })
    const committed = await hub.invokeWithCapability(capability.token, {
      action: 'notes.create',
      input: { title: 'Launch' },
      idempotencyKey: 'write-idem',
      metadata: { approvalId: approval.id },
    })
    const replay = await hub.invokeWithCapability(capability.token, {
      action: 'notes.create',
      input: { title: 'Launch' },
      idempotencyKey: 'write-idem',
      metadata: { approvalId: approval.id },
    })
    const conflict = await hub.invokeWithCapability(capability.token, {
      action: 'notes.create',
      input: { title: 'Different' },
      idempotencyKey: 'write-idem',
      metadata: { approvalId: approval.id },
    })

    expect(committed.ok).toBe(true)
    expect(replay.metadata?.idempotentReplay).toBe(true)
    expect(conflict).toMatchObject({
      ok: false,
      output: { idempotencyConflict: true },
    })
    expect(mutations).toBe(1)
  })

  it('guards idempotency, dry-run mutations, and audit records', async () => {
    let calls = 0
    const audit = new InMemoryIntegrationAuditStore()
    const guard = new DefaultIntegrationActionGuard({
      idempotency: new InMemoryIntegrationIdempotencyStore(),
      audit,
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    })
    const ctx = {
      connection: activeConnection('conn_notes'),
      request: { connectionId: 'conn_notes', action: 'notes.create', input: { title: 'A' }, idempotencyKey: 'idem-1' },
      action: { id: 'notes.create', title: 'Create', risk: 'write' as const, requiredScopes: [], dataClass: 'private' as const },
    }

    const first = await guard.invokeAction(ctx, async () => {
      calls += 1
      return { ok: true, action: 'notes.create', output: { id: 'note_1' } }
    })
    const replay = await guard.invokeAction(ctx, async () => {
      calls += 1
      return { ok: true, action: 'notes.create', output: { id: 'note_2' } }
    })
    const drift = await guard.invokeAction({
      ...ctx,
      request: { ...ctx.request, input: { title: 'B' } },
    }, async () => {
      calls += 1
      return { ok: true, action: 'notes.create' }
    })
    const dryRun = await guard.invokeAction({
      ...ctx,
      request: { ...ctx.request, idempotencyKey: 'idem-2', dryRun: true },
    }, async () => {
      calls += 1
      return { ok: true, action: 'notes.create' }
    })

    expect(calls).toBe(1)
    expect(first.ok).toBe(true)
    expect(replay.metadata?.idempotentReplay).toBe(true)
    expect(drift.ok).toBe(false)
    expect(dryRun.metadata?.dryRun).toBe(true)
    expect(audit.list({ type: 'action.invoked' })).toHaveLength(1)
  })

  it('can require idempotency keys for state-changing actions', async () => {
    const guard = new DefaultIntegrationActionGuard({
      idempotency: new InMemoryIntegrationIdempotencyStore(),
      requireIdempotencyForMutations: true,
    })
    const ctx = {
      connection: activeConnection('conn_notes'),
      request: { connectionId: 'conn_notes', action: 'notes.create', input: { title: 'A' } },
      action: { id: 'notes.create', title: 'Create', risk: 'write' as const, requiredScopes: [], dataClass: 'private' as const },
    }

    const missingKey = await guard.invokeAction(ctx, async () => ({ ok: true, action: 'notes.create' }))
    const withKey = await guard.invokeAction({
      ...ctx,
      request: { ...ctx.request, idempotencyKey: 'idem-required' },
    }, async () => ({ ok: true, action: 'notes.create' }))

    expect(missingKey).toMatchObject({
      ok: false,
      output: { idempotencyRequired: true },
    })
    expect(withKey.ok).toBe(true)
  })

  it('refreshes expired oauth credentials without exposing raw secrets in connection records', async () => {
    const secrets = new InMemoryIntegrationSecretStore()
    const connections = new InMemoryConnectionStore()
    const connection = activeConnection('conn_notes', {
      secretRef: { provider: 'vault', id: 'secret_1' },
      expiresAt: '2026-05-04T00:00:00.000Z',
    })
    await connections.put(connection)
    await secrets.put(connection.secretRef!, {
      kind: 'oauth2',
      accessToken: 'old',
      refreshToken: 'refresh',
      expiresAt: Date.parse('2026-05-04T00:00:00.000Z'),
    })
    const resolver = createConnectionCredentialResolver({
      secrets,
      connections,
      adapters: [refreshingAdapter],
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    })

    const source = await resolver(connection)
    const updated = await connections.get(connection.id)

    expect(source.credentials).toMatchObject({ kind: 'oauth2', accessToken: 'new' })
    expect(updated?.secretRef).toEqual({ provider: 'vault', id: 'secret_1' })
    expect(JSON.stringify(updated)).not.toContain('new')
  })

  it('builds bridge env payloads that sandboxes and executor-style CLIs can consume', async () => {
    const store = new InMemoryConnectionStore()
    const hub = new IntegrationHub({
      providers: [createConnectorAdapterProvider({ adapters: [notesAdapter], resolveDataSource: (connection) => sourceFor(connection.id) })],
      store,
      capabilitySecret: 'secret',
    })
    const grants = new InMemoryIntegrationGrantStore()
    const runtime = createIntegrationRuntime({ hub, grants })
    await store.put(activeConnection('conn_notes'))
    await runtime.createGrants({ manifest: notesManifest, owner, grantee: { type: 'app', id: 'notes-app' } })
    const bundle = await runtime.buildSandboxBundle({
      owner,
      manifestId: notesManifest.id,
      grantee: { type: 'app', id: 'notes-app' },
      subject: sandbox,
      ttlMs: 60_000,
    })

    const env = buildIntegrationBridgeEnvironment(bundle)
    const parsed = parseIntegrationBridgeEnvironment(env)
    const decoded = decodeIntegrationBridgePayload(env.TANGLE_INTEGRATION_BUNDLE)

    expect(parsed.tools[0].capabilityToken.length).toBeGreaterThan(20)
    expect(decoded.tools[0]).toMatchObject({ action: 'notes.search', connectorId: 'notes' })
  })

  it('healthchecks active and broken connections with optional live tests', async () => {
    const registryHub = new IntegrationHub({
      providers: [createConnectorAdapterProvider({ adapters: [notesAdapter], resolveDataSource: (connection) => sourceFor(connection.id) })],
      store: new InMemoryConnectionStore(),
      capabilitySecret: 'secret',
    })
    const registry = await registryHub.listRegistry()
    const healthStore = new InMemoryIntegrationHealthcheckStore()

    const [healthy, revoked] = await runIntegrationHealthchecks({
      connections: [activeConnection('conn_notes'), { ...activeConnection('conn_bad'), status: 'revoked' }],
      registry,
      store: healthStore,
      test: () => true,
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    })

    expect(healthy.status).toBe('healthy')
    expect(revoked.status).toBe('unhealthy')
    expect(healthStore.list()).toHaveLength(2)
  })

  it('receives webhooks, rejects bad signatures, and dedupes provider events', async () => {
    const store = new InMemoryIntegrationEventStore()
    const source = sourceFor('conn_notes')
    const invalid = await receiveIntegrationWebhook({
      adapter: webhookAdapter,
      source,
      rawBody: '{"id":"evt_1"}',
      headers: { 'x-test-signature': 'bad' },
      store,
    })
    const first = await receiveIntegrationWebhook({
      adapter: webhookAdapter,
      source,
      rawBody: '{"id":"evt_1"}',
      headers: { 'x-test-signature': 'ok' },
      store,
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    })
    const second = await receiveIntegrationWebhook({
      adapter: webhookAdapter,
      source,
      rawBody: '{"id":"evt_1"}',
      headers: { 'x-test-signature': 'ok' },
      store,
      now: () => new Date('2026-05-05T00:00:01.000Z'),
    })

    expect(invalid.status).toBe(401)
    expect(first.received).toHaveLength(1)
    expect(second.duplicates).toHaveLength(1)
    expect(store.list()).toHaveLength(1)
  })

  it('fails closed for unsigned webhook adapters unless explicitly allowed', async () => {
    const store = new InMemoryIntegrationEventStore()
    const source = sourceFor('conn_notes')
    const unsignedAdapter: ConnectorAdapter = {
      ...notesAdapter,
      async handleInboundEvent(input) {
        const body = JSON.parse(input.rawBody) as { id: string }
        return {
          events: [{
            eventType: 'note.created',
            providerEventId: body.id,
            payload: { id: body.id },
          }],
        }
      },
    }

    const rejected = await receiveIntegrationWebhook({
      adapter: unsignedAdapter,
      source,
      rawBody: '{"id":"evt_unsigned"}',
      headers: {},
      store,
    })
    const allowed = await receiveIntegrationWebhook({
      adapter: unsignedAdapter,
      source,
      rawBody: '{"id":"evt_unsigned"}',
      headers: {},
      store,
      allowUnsignedWebhook: true,
    })

    expect(rejected.status).toBe(401)
    expect(allowed.received).toHaveLength(1)
  })

  it('dispatches sandbox invocation envelopes through the hub and normalizes failures', async () => {
    const store = new InMemoryConnectionStore()
    const provider = createConnectorAdapterProvider({
      adapters: [notesAdapter],
      resolveDataSource: (connection) => sourceFor(connection.id),
    })
    const hub = new IntegrationHub({ providers: [provider], store, capabilitySecret: 'secret' })
    await store.put(activeConnection('conn_notes'))
    const [tool] = buildIntegrationToolCatalog(await provider.listConnectors())
    const capability = await hub.issueCapability({
      subject: sandbox,
      connectionId: 'conn_notes',
      scopes: [],
      allowedActions: ['notes.search'],
      ttlMs: 60_000,
    })
    const envelope = buildIntegrationInvocationEnvelope({
      capabilityToken: capability.token,
      toolName: tool.name,
      args: { q: 'launch' },
      idempotencyKey: 'search-1',
    })

    const ok = await dispatchIntegrationInvocation(envelope, {
      hub,
      connectors: await provider.listConnectors(),
      requireKnownTool: true,
    })
    const failed = await dispatchIntegrationInvocation({ ...envelope, action: 'notes.create' }, { hub })

    expect(ok).toMatchObject({ status: 'ok', action: 'notes.search' })
    expect(failed.status).toBe('failed')
  })
})

const notesManifest: IntegrationManifest = {
  id: 'notes-app',
  requirements: [{
    id: 'notes-read',
    connectorId: 'notes',
    mode: 'read',
    reason: 'Read notes.',
    requiredActions: ['notes.search'],
  }],
}

const notesAdapter: ConnectorAdapter = {
  manifest: {
    kind: 'notes',
    displayName: 'Notes',
    description: 'Read and write notes.',
    auth: { kind: 'none' },
    category: 'doc',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      { name: 'notes.search', class: 'read', description: 'Search notes.', parameters: {} },
      { name: 'notes.create', class: 'mutation', description: 'Create notes.', parameters: {}, cas: 'native-idempotency', externalEffect: false },
    ],
  },
  async executeRead(invocation) {
    return { data: { q: invocation.args.q, items: [] }, fetchedAt: 1 }
  },
  async executeMutation(invocation) {
    return { status: 'committed', data: invocation.args, committedAt: 1, idempotentReplay: false }
  },
  async test() {
    return { ok: true }
  },
}

const refreshingAdapter: ConnectorAdapter = {
  ...notesAdapter,
  async refreshToken() {
    return {
      kind: 'oauth2',
      accessToken: 'new',
      refreshToken: 'refresh',
      expiresAt: Date.parse('2026-05-06T00:00:00.000Z'),
    }
  },
}

const webhookAdapter: ConnectorAdapter = {
  ...notesAdapter,
  verifySignature(input) {
    return { valid: input.headers['x-test-signature'] === 'ok' }
  },
  async handleInboundEvent(input) {
    const body = JSON.parse(input.rawBody) as { id: string }
    return {
      events: [{
        eventType: 'note.created',
        providerEventId: body.id,
        payload: { id: body.id },
      }],
    }
  },
}

function activeConnection(id: string, overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return { ...baseConnection(id), ...overrides }
}

function baseConnection(id: string): IntegrationConnection {
  return {
    id,
    owner,
    providerId: 'first-party',
    connectorId: 'notes',
    status: 'active' as const,
    grantedScopes: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

function sourceFor(connectionId: string): ResolvedDataSource {
  return {
    id: connectionId,
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'notes',
    label: 'Notes',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { providerId: 'first-party' },
    credentials: { kind: 'none' },
    status: 'active',
  }
}
