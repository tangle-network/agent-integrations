import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatwootConnector } from '../src/connectors/adapters/chatwoot.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_chatwoot_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'chatwoot',
    label: 'Drew Workspace',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl: 'https://chat.example.com' },
    credentials: { kind: 'api-key', apiKey: 'test-token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chatwoot adapter manifest', () => {
  it('identifies itself as the chatwoot kind under the comms category', () => {
    expect(chatwootConnector.manifest.kind).toBe('chatwoot')
    expect(chatwootConnector.manifest.category).toBe('comms')
    expect(chatwootConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = chatwootConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes send.message plus the new write surface as mutations', () => {
    const names = chatwootConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['assign_conversation', 'send.message', 'toggle_status'].sort(),
    )
    for (const name of ['send.message', 'toggle_status', 'assign_conversation']) {
      const cap = chatwootConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap?.class).toBe('mutation')
    }
  })

  it('declares native-idempotency CAS + externalEffect on the new writes', () => {
    const toggle = chatwootConnector.manifest.capabilities.find(
      (c) => c.name === 'toggle_status',
    )
    const assign = chatwootConnector.manifest.capabilities.find(
      (c) => c.name === 'assign_conversation',
    )
    expect(toggle?.class).toBe('mutation')
    expect(assign?.class).toBe('mutation')
    if (toggle?.class === 'mutation') {
      expect(toggle.cas).toBe('native-idempotency')
      expect(toggle.externalEffect).toBe(true)
    }
    if (assign?.class === 'mutation') {
      expect(assign.cas).toBe('native-idempotency')
      expect(assign.externalEffect).toBe(true)
    }
  })

  it('declares the required-arg surface for the new writes', () => {
    const toggle = chatwootConnector.manifest.capabilities.find(
      (c) => c.name === 'toggle_status',
    )
    const assign = chatwootConnector.manifest.capabilities.find(
      (c) => c.name === 'assign_conversation',
    )
    expect((toggle?.parameters as { required?: string[] }).required).toEqual(
      ['account_id', 'conversation_id', 'status'],
    )
    expect((assign?.parameters as { required?: string[] }).required).toEqual(
      ['account_id', 'conversation_id', 'assignee_id'],
    )
  })
})

describe('chatwoot toggle_status', () => {
  it('POSTs the status to the toggle_status endpoint and returns the response', async () => {
    let seenUrl = ''
    let seenMethod = ''
    let seenBody: unknown = null
    let seenAuth = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input instanceof URL ? input.toString() : input)
      seenMethod = init?.method ?? 'GET'
      seenBody = init?.body ? JSON.parse(init.body as string) : null
      const headers = init?.headers as Record<string, string> | undefined
      seenAuth = headers?.api_access_token ?? ''
      return jsonResponse({ id: 42, status: 'resolved' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatwootConnector.executeMutation!({
      source: source(),
      capabilityName: 'toggle_status',
      args: { account_id: 7, conversation_id: 42, status: 'resolved' },
      idempotencyKey: 'idemp-toggle-1',
    })

    expect(result.status).toBe('committed')
    expect(seenMethod).toBe('POST')
    expect(seenUrl).toBe(
      'https://chat.example.com/api/v1/accounts/7/conversations/42/toggle_status',
    )
    expect(seenBody).toEqual({ status: 'resolved' })
    expect(seenAuth).toBe('test-token')
    if (result.status === 'committed') {
      expect(result.data).toEqual({ id: 42, status: 'resolved' })
    }
  })

  it('rejects when required args are missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      chatwootConnector.executeMutation!({
        source: source(),
        capabilityName: 'toggle_status',
        args: { conversation_id: 42, status: 'open' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/account_id/)
    await expect(
      chatwootConnector.executeMutation!({
        source: source(),
        capabilityName: 'toggle_status',
        args: { account_id: 7, status: 'open' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/conversation_id/)
    await expect(
      chatwootConnector.executeMutation!({
        source: source(),
        capabilityName: 'toggle_status',
        args: { account_id: 7, conversation_id: 42 },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/status/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('unauthorized', {
            status: 401,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      chatwootConnector.executeMutation!({
        source: source(),
        capabilityName: 'toggle_status',
        args: { account_id: 7, conversation_id: 42, status: 'resolved' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('chatwoot assign_conversation', () => {
  it('POSTs assignee_id to the assignments endpoint and returns the response', async () => {
    let seenUrl = ''
    let seenMethod = ''
    let seenBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input instanceof URL ? input.toString() : input)
      seenMethod = init?.method ?? 'GET'
      seenBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 11, name: 'agent-eleven' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatwootConnector.executeMutation!({
      source: source(),
      capabilityName: 'assign_conversation',
      args: { account_id: 7, conversation_id: 42, assignee_id: 11 },
      idempotencyKey: 'idemp-assign-1',
    })

    expect(result.status).toBe('committed')
    expect(seenMethod).toBe('POST')
    expect(seenUrl).toBe(
      'https://chat.example.com/api/v1/accounts/7/conversations/42/assignments',
    )
    expect(seenBody).toEqual({ assignee_id: 11 })
    if (result.status === 'committed') {
      expect(result.data).toEqual({ id: 11, name: 'agent-eleven' })
    }
  })

  it('rejects when required args are missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      chatwootConnector.executeMutation!({
        source: source(),
        capabilityName: 'assign_conversation',
        args: { conversation_id: 42, assignee_id: 11 },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/account_id/)
    await expect(
      chatwootConnector.executeMutation!({
        source: source(),
        capabilityName: 'assign_conversation',
        args: { account_id: 7, assignee_id: 11 },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/conversation_id/)
    await expect(
      chatwootConnector.executeMutation!({
        source: source(),
        capabilityName: 'assign_conversation',
        args: { account_id: 7, conversation_id: 42 },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/assignee_id/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('forbidden', {
            status: 403,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      chatwootConnector.executeMutation!({
        source: source(),
        capabilityName: 'assign_conversation',
        args: { account_id: 7, conversation_id: 42, assignee_id: 11 },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
