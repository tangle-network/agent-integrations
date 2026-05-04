import { describe, expect, it } from 'vitest'
import {
  InMemoryConnectionStore,
  IntegrationError,
  IntegrationHub,
  createHttpIntegrationProvider,
  createMockIntegrationProvider,
  sanitizeConnection,
  verifyCapabilityToken,
} from '../src/index'

const owner = { type: 'user' as const, id: 'user_1' }

describe('IntegrationHub', () => {
  it('lists connectors without exposing a vendor-specific API', async () => {
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store: new InMemoryConnectionStore(),
      capabilitySecret: 'secret',
    })

    const connectors = await hub.listConnectors()

    expect(connectors.map((connector) => connector.id)).toContain('gmail')
    expect(connectors[0]?.actions.map((action) => action.id)).toContain('messages.search')
  })

  it('runs OAuth-shaped connect flow and stores secret refs, not raw credentials', async () => {
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store: new InMemoryConnectionStore(),
      capabilitySecret: 'secret',
    })

    const auth = await hub.startAuth('mock', {
      connectorId: 'gmail',
      owner,
      requestedScopes: ['email.read'],
      redirectUri: 'https://app.example/callback',
      state: 'state_1',
    })
    const connection = await hub.completeAuth('mock', {
      connectorId: 'gmail',
      owner,
      code: 'code',
      state: auth.state,
      redirectUri: 'https://app.example/callback',
    })

    expect(auth.authUrl).toContain('state_1')
    expect(connection.secretRef).toMatchObject({ provider: 'mock' })
    expect(JSON.stringify(sanitizeConnection(connection))).not.toContain('secret_')
  })

  it('invokes only actions and scopes allowed by a short-lived capability', async () => {
    const store = new InMemoryConnectionStore()
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store,
      capabilitySecret: 'secret',
      now: () => new Date('2026-05-04T00:00:00.000Z'),
    })
    await hub.upsertConnection({
      id: 'conn_1',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read', 'email.write'],
      secretRef: { provider: 'mock', id: 'secret_1' },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    const issued = await hub.issueCapability({
      subject: { type: 'sandbox', id: 'sandbox_1' },
      connectionId: 'conn_1',
      scopes: ['email.read'],
      allowedActions: ['messages.search'],
      ttlMs: 60_000,
    })

    const result = await hub.invokeWithCapability(issued.token, {
      action: 'messages.search',
      input: { q: 'is:unread' },
    })

    expect(result).toMatchObject({ ok: true, action: 'messages.search' })
    await expect(hub.invokeWithCapability(issued.token, {
      action: 'drafts.create',
      input: { to: 'a@example.com' },
    })).rejects.toMatchObject({ code: 'action_denied' })
  })

  it('rejects expired capabilities and inactive connections', async () => {
    const store = new InMemoryConnectionStore()
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store,
      capabilitySecret: 'secret',
      now: () => new Date('2026-05-04T00:00:00.000Z'),
    })
    await hub.upsertConnection({
      id: 'conn_expired',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    const issued = await hub.issueCapability({
      subject: { type: 'sandbox', id: 'sandbox_1' },
      connectionId: 'conn_expired',
      scopes: ['email.read'],
      allowedActions: ['messages.search'],
      ttlMs: 1,
    })
    const later = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store,
      capabilitySecret: 'secret',
      now: () => new Date('2026-05-04T00:00:01.000Z'),
    })

    await expect(later.invokeWithCapability(issued.token, {
      action: 'messages.search',
    })).rejects.toMatchObject({ code: 'capability_expired' })

    await store.put({ ...(await store.get('conn_expired'))!, status: 'revoked' })
    const fresh = await hub.issueCapability({
      subject: { type: 'sandbox', id: 'sandbox_1' },
      connectionId: 'conn_expired',
      scopes: ['email.read'],
      allowedActions: ['messages.search'],
      ttlMs: 60_000,
    }).catch((error: unknown) => error)

    expect(fresh).toBeInstanceOf(IntegrationError)
    expect(fresh).toMatchObject({ code: 'connection_not_active' })
  })

  it('subscribes to normalized triggers with connection scope checks', async () => {
    const store = new InMemoryConnectionStore()
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store,
      capabilitySecret: 'secret',
    })
    await hub.upsertConnection({
      id: 'conn_trigger',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })

    const sub = await hub.subscribeTrigger('conn_trigger', 'message.received', 'https://app.example/events')

    expect(sub).toMatchObject({
      connectionId: 'conn_trigger',
      trigger: 'message.received',
      status: 'active',
    })
  })

  it('rejects tampered capability tokens with a typed error', () => {
    expect(() => verifyCapabilityToken('not-a-token', 'secret')).toThrow(IntegrationError)
  })

  it('adapts generic HTTP integration gateways without vendor lock-in', async () => {
    const calls: Array<{ url: string; body: unknown; authorization?: string }> = []
    const provider = createHttpIntegrationProvider({
      id: 'gateway',
      kind: 'pipedream',
      baseUrl: 'https://integrations.example',
      bearer: 'provider-token',
      connectors: [{
        id: 'slack',
        providerId: 'gateway',
        title: 'Slack',
        category: 'chat',
        auth: 'oauth2',
        scopes: ['chat.write'],
        actions: [{
          id: 'messages.send',
          title: 'Send message',
          risk: 'write',
          requiredScopes: ['chat.write'],
          dataClass: 'private',
          approvalRequired: true,
        }],
      }],
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          authorization: new Headers(init?.headers).get('authorization') ?? undefined,
        })
        return Response.json({ ok: true, action: 'messages.send', output: { ts: '1' } })
      },
    })
    const hub = new IntegrationHub({
      providers: [provider],
      store: new InMemoryConnectionStore(),
      capabilitySecret: 'secret',
    })
    await hub.upsertConnection({
      id: 'conn_slack',
      owner,
      providerId: 'gateway',
      connectorId: 'slack',
      status: 'active',
      grantedScopes: ['chat.write'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    const capability = await hub.issueCapability({
      subject: { type: 'sandbox', id: 'sandbox_1' },
      connectionId: 'conn_slack',
      scopes: ['chat.write'],
      allowedActions: ['messages.send'],
      ttlMs: 60_000,
    })

    const result = await hub.invokeWithCapability(capability.token, {
      action: 'messages.send',
      input: { channel: 'C1', text: 'hello' },
    })

    expect(result).toMatchObject({ ok: true, action: 'messages.send' })
    expect(calls[0]).toMatchObject({
      url: 'https://integrations.example/actions/invoke',
      authorization: 'Bearer provider-token',
    })
  })

  it('threads invokeWithCapability through an IntegrationActionGuard, allowing short-circuit and pass-through', async () => {
    const guardCalls: Array<{ action: string; proceeded: boolean }> = []
    let providerInvocations = 0
    const provider = createMockIntegrationProvider({
      onInvoke: () => {
        providerInvocations++
        return { ok: true, action: 'messages.search', output: { items: [] } }
      },
    })
    const hub = new IntegrationHub({
      providers: [provider],
      store: new InMemoryConnectionStore(),
      capabilitySecret: 'secret',
      guard: {
        async invokeAction(ctx, proceed) {
          // First call: short-circuit (replay scenario).
          if (ctx.request.idempotencyKey === 'cached-key') {
            guardCalls.push({ action: ctx.request.action, proceeded: false })
            return { ok: true, action: ctx.request.action, output: { items: [], cached: true } }
          }
          // Second call: proceed.
          guardCalls.push({ action: ctx.request.action, proceeded: true })
          return proceed()
        },
      },
    })
    await hub.upsertConnection({
      id: 'conn_mock',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    const capability = await hub.issueCapability({
      subject: { type: 'agent', id: 'agent_1' },
      connectionId: 'conn_mock',
      scopes: ['email.read'],
      allowedActions: ['messages.search'],
      ttlMs: 60_000,
    })

    const cached = await hub.invokeWithCapability(capability.token, {
      action: 'messages.search',
      input: {},
      idempotencyKey: 'cached-key',
    })
    const live = await hub.invokeWithCapability(capability.token, {
      action: 'messages.search',
      input: {},
      idempotencyKey: 'fresh-key',
    })

    expect(cached.output).toMatchObject({ cached: true })
    expect(live.output).toMatchObject({ items: [] })
    expect(guardCalls).toHaveLength(2)
    expect(guardCalls[0].proceeded).toBe(false)
    expect(guardCalls[1].proceeded).toBe(true)
    // The guard short-circuited the first call → only one provider invocation.
    expect(providerInvocations).toBe(1)
  })
})
