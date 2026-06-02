import { afterEach, describe, expect, it, vi } from 'vitest'
import { kustomerConnector } from '../src/connectors/adapters/kustomer.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_kustomer_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'kustomer',
    label: 'kustomer test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'kustomer_secret' },
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

describe('kustomer adapter manifest', () => {
  it('classifies itself as the crm category and exposes the kustomer kind', () => {
    expect(kustomerConnector.manifest.kind).toBe('kustomer')
    expect(kustomerConnector.manifest.category).toBe('crm')
    expect(kustomerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = kustomerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set plus the write-side capability expansion', () => {
    const names = kustomerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'customers.create',
        'customers.update',
        'customers.delete',
        'customers.get',
        'customers.search',
        'conversations.create',
        'conversations.get',
        'conversations.update',
        'conversations.close',
        'customObjects.get',
        'customObjects.create',
      ].sort(),
    )
    const reads = kustomerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = kustomerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['customers.get', 'customers.search', 'conversations.get', 'customObjects.get'].sort())
    expect(mutations).toEqual(
      [
        'customers.create',
        'customers.update',
        'customers.delete',
        'conversations.create',
        'conversations.update',
        'conversations.close',
        'customObjects.create',
      ].sort(),
    )
  })

  it('marks newly added mutations as native-idempotency external effects', () => {
    const NEW = new Set(['customers.update', 'customers.delete', 'conversations.close'])
    for (const c of kustomerConnector.manifest.capabilities) {
      if (c.class !== 'mutation' || !NEW.has(c.name)) continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('kustomer customers.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a PUT to the customer resource', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ data: { id: 'cust_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kustomerConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.update',
      args: { customerId: 'cust_1', firstName: 'Updated' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/v1/customers/cust_1')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      kustomerConnector.executeMutation!({
        source: source(),
        capabilityName: 'customers.update',
        args: { customerId: 'cust_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('kustomer customers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE against the customer resource', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kustomerConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.delete',
      args: { customerId: 'cust_42' },
      idempotencyKey: 'k-del',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/customers/cust_42')
  })
})

describe('kustomer conversations.close', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes the conversation with status=done', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ data: { id: 'conv_9' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kustomerConnector.executeMutation!({
      source: source(),
      capabilityName: 'conversations.close',
      args: { conversationId: 'conv_9' },
      idempotencyKey: 'k-close',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/conversations/conv_9')
    expect(requestBody).toBeDefined()
    const parsed = JSON.parse(requestBody as string) as { conversation: { status: string } }
    expect(parsed.conversation.status).toBe('done')
  })
})
