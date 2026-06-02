import { afterEach, describe, expect, it, vi } from 'vitest'
import { systemeIoConnector } from '../src/connectors/adapters/systeme-io.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_systeme_io_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'systeme-io',
    label: 'systeme-io test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'systeme_secret' },
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

describe('systeme-io adapter manifest', () => {
  it('classifies itself as the crm category and exposes the systeme-io kind', () => {
    expect(systemeIoConnector.manifest.kind).toBe('systeme-io')
    expect(systemeIoConnector.manifest.category).toBe('crm')
    expect(systemeIoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = systemeIoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the action set: contacts, tags, and campaigns', () => {
    const names = systemeIoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('contacts.create')
    expect(names).toContain('contacts.update')
    expect(names).toContain('contacts.delete')
    expect(names).toContain('contacts.findByEmail')
    expect(names).toContain('tags.create')
    expect(names).toContain('tags.delete')
    expect(names).toContain('tags.addToContact')
    expect(names).toContain('tags.removeFromContact')
    expect(names).toContain('campaigns.list')
    expect(names).toContain('campaigns.subscribe')
  })

  it('marks every new write-side mutation as native-idempotency + externalEffect=true', () => {
    const newMutations = new Set([
      'contacts.delete',
      'tags.create',
      'tags.delete',
      'campaigns.subscribe',
    ])
    const caps = systemeIoConnector.manifest.capabilities.filter(
      (c) => newMutations.has(c.name) && c.class === 'mutation',
    )
    expect(caps.length).toBe(newMutations.size)
    for (const cap of caps) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('exposes campaigns.list as a read capability', () => {
    const cap = systemeIoConnector.manifest.capabilities.find((c) => c.name === 'campaigns.list')
    expect(cap?.class).toBe('read')
  })
})

describe('systeme-io contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/contacts/{contactId} with bearer auth', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let authHeader: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      const headers = init?.headers as Record<string, string> | undefined
      authHeader = headers?.authorization
      return jsonResponse({}, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await systemeIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { contactId: 'c_1' },
      idempotencyKey: 'k-del-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/contacts/c_1')
    expect(authHeader).toBe('Bearer systeme_secret')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      systemeIoConnector.executeMutation!({
        source: source(),
        capabilityName: 'contacts.delete',
        args: { contactId: 'c_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('systeme-io tags.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/tags with the name body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'tag_1', name: 'VIP' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await systemeIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'tags.create',
      args: { name: 'VIP' },
      idempotencyKey: 'k-tag-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/tags')
    expect(requestBody).toMatchObject({ name: 'VIP' })
  })
})

describe('systeme-io tags.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/tags/{tagId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await systemeIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'tags.delete',
      args: { tagId: 'tag_1' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/tags/tag_1')
  })
})

describe('systeme-io campaigns.subscribe', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/community/campaigns/{campaignId}/subscribers with the contact body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ subscribed: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await systemeIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.subscribe',
      args: { campaignId: 'camp_1', contactId: 'c_1' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/community/campaigns/camp_1/subscribers')
    expect(requestBody).toMatchObject({ contactId: 'c_1' })
  })
})

describe('systeme-io campaigns.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues GET /v1/community/campaigns', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await systemeIoConnector.executeRead!({
      source: source(),
      capabilityName: 'campaigns.list',
      args: {},
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/v1/community/campaigns')
  })
})
