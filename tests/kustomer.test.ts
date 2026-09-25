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
  it('uses api-key auth', () => {
    const auth = kustomerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
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
