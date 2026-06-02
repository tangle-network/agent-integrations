import { afterEach, describe, expect, it, vi } from 'vitest'
import { bigcommerceConnector } from '../src/connectors/adapters/bigcommerce.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bigcommerce_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bigcommerce',
    label: 'BigCommerce test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { apiBaseUrl: 'https://api.bigcommerce.com/stores/abc123' },
    credentials: { kind: 'oauth2', accessToken: 'token_abc' },
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

describe('bigcommerce adapter write-side capabilities', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('marks every mutation as native-idempotency externalEffect', () => {
    const caps = bigcommerceConnector.manifest.capabilities
    for (const c of caps) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })

  it('exposes the extended write surface (refund / product delete / customer create+update)', () => {
    const mutations = bigcommerceConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'customers.create',
        'customers.update',
        'orders.refund',
        'orders.update',
        'products.create',
        'products.delete',
        'products.update',
      ].sort(),
    )
  })

  it('issues a POST against the order-scoped refund path with the renamed body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ id: 9001 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bigcommerceConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.refund',
      args: {
        orderId: 1001,
        items: [{ item_id: 1, item_type: 'PRODUCT', quantity: 1 }],
        memo: 'customer return',
      },
      idempotencyKey: 'idem_refund',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.bigcommerce.com/stores/abc123/v3/orders/1001/payment_actions/refunds')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({
      items: [{ item_id: 1, item_type: 'PRODUCT', quantity: 1 }],
      memo: 'customer return',
    })
  })

  it('DELETEs a product at the store-scoped v3 catalog path', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bigcommerceConnector.executeMutation!({
      source: source(),
      capabilityName: 'products.delete',
      args: { productId: 42 },
      idempotencyKey: 'idem_del',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.bigcommerce.com/stores/abc123/v3/catalog/products/42')
  })

  it('POSTs the customers[] array to /v3/customers on create', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ data: [{ id: 12 }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bigcommerceConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.create',
      args: {
        customers: [{ email: 'a@b.com', first_name: 'A', last_name: 'B' }],
      },
      idempotencyKey: 'idem_cust',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.bigcommerce.com/stores/abc123/v3/customers')
    expect(JSON.parse(requestBody ?? '{}')).toEqual([
      { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    ])
  })

  it('PUTs the customers[] array to /v3/customers on update', async () => {
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestMethod = init?.method
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ data: [{ id: 12 }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await bigcommerceConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.update',
      args: { customers: [{ id: 12, last_name: 'Z' }] },
      idempotencyKey: 'idem_cust_u',
    })

    expect(requestMethod).toBe('PUT')
    expect(JSON.parse(requestBody ?? '{}')).toEqual([{ id: 12, last_name: 'Z' }])
  })

  it('surfaces CredentialsExpired when a write fails on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      bigcommerceConnector.executeMutation!({
        source: source(),
        capabilityName: 'products.delete',
        args: { productId: 1 },
        idempotencyKey: 'idem_x',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
