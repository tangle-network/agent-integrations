import { afterEach, describe, expect, it, vi } from 'vitest'
import { orimonConnector } from '../src/connectors/adapters/orimon.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_orimon_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'orimon',
    label: 'Orimon test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'orimon_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('orimon adapter manifest', () => {
  it('classifies itself as the comms category and exposes the orimon kind', () => {
    expect(orimonConnector.manifest.kind).toBe('orimon')
    expect(orimonConnector.manifest.category).toBe('comms')
    expect(orimonConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = orimonConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Orimon/i)
  })

  it('covers messages, conversations, and leads capability surface', () => {
    const names = orimonConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'conversations.close',
        'conversations.get',
        'conversations.list',
        'leads.create',
        'messages.send',
        'leads.update',
        'leads.delete',
        'conversations.assign',
        'conversations.tag',
      ].sort(),
    )
    const mutations = orimonConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'conversations.close',
        'leads.create',
        'messages.send',
        'leads.update',
        'leads.delete',
        'conversations.assign',
        'conversations.tag',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency with external effect', () => {
    for (const c of orimonConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('orimon leads.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/tenants/{tenantId}/leads/{leadId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ id: 'lead_abc' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await orimonConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.update',
      args: { tenantId: 'tnt_1', leadId: 'lead_abc', email: 'new@example.com' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/tenants/tnt_1/leads/lead_abc')
    expect(requestBody).toMatchObject({ email: 'new@example.com' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      orimonConnector.executeMutation!({
        source: source(),
        capabilityName: 'leads.update',
        args: { tenantId: 'tnt_1', leadId: 'lead_abc' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('orimon leads.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/tenants/{tenantId}/leads/{leadId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await orimonConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.delete',
      args: { tenantId: 'tnt_1', leadId: 'lead_abc' },
      idempotencyKey: 'k-2',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/tenants/tnt_1/leads/lead_abc')
  })
})

describe('orimon conversations.assign', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/tenants/{tenantId}/conversations/{conversationId}/assign', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await orimonConnector.executeMutation!({
      source: source(),
      capabilityName: 'conversations.assign',
      args: { tenantId: 'tnt_1', conversationId: 'cnv_1', agentId: 'agent_42' },
      idempotencyKey: 'k-3',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/tenants/tnt_1/conversations/cnv_1/assign')
    expect(requestBody).toMatchObject({ agentId: 'agent_42' })
  })
})

describe('orimon conversations.tag', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/tenants/{tenantId}/conversations/{conversationId}/tags', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await orimonConnector.executeMutation!({
      source: source(),
      capabilityName: 'conversations.tag',
      args: { tenantId: 'tnt_1', conversationId: 'cnv_1', tag: 'vip' },
      idempotencyKey: 'k-4',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/tenants/tnt_1/conversations/cnv_1/tags')
    expect(requestBody).toMatchObject({ tag: 'vip' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      orimonConnector.executeMutation!({
        source: source(),
        capabilityName: 'conversations.tag',
        args: { tenantId: 'tnt_1', conversationId: 'cnv_1', tag: 'vip' },
        idempotencyKey: 'k-4',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
