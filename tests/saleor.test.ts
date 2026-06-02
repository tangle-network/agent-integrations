import { afterEach, describe, expect, it, vi } from 'vitest'
import { saleorConnector } from '../src/connectors/adapters/saleor.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_saleor_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'saleor',
    label: 'saleor test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { apiUrl: 'https://shop.example/graphql/' },
    credentials: { kind: 'api-key', apiKey: 'saleor_secret' },
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

describe('saleor adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the saleor kind', () => {
    expect(saleorConnector.manifest.kind).toBe('saleor')
    expect(saleorConnector.manifest.category).toBe('commerce')
    expect(saleorConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = saleorConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Saleor/i)
  })

  it('covers graphql query, order retrieval, and order-lifecycle mutations', () => {
    const names = saleorConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'graphql.query',
        'orders.addNote',
        'orders.cancel',
        'orders.fulfill',
        'orders.get',
        'orders.refund',
        'orders.update',
      ].sort(),
    )
    const mutations = saleorConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['orders.addNote', 'orders.cancel', 'orders.fulfill', 'orders.refund', 'orders.update'].sort(),
    )
  })

  it('marks all mutations as native-idempotency external-effect', () => {
    for (const c of saleorConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('saleor orders.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a cancel GraphQL mutation to the configured api url', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? String(init.body) : ''
      return jsonResponse({ data: { orderCancel: { order: { id: 'order_1', status: 'CANCELED' }, errors: [] } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await saleorConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.cancel',
      args: { orderId: 'order_1' },
      idempotencyKey: 'k-cancel',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://shop.example/graphql/')
    const parsed = JSON.parse(requestBody) as { query: string; variables: { id: string } }
    expect(parsed.query).toContain('orderCancel')
    expect(parsed.variables).toEqual({ id: 'order_1' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      saleorConnector.executeMutation!({
        source: source(),
        capabilityName: 'orders.cancel',
        args: { orderId: 'order_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('saleor orders.fulfill', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs an orderFulfill mutation with structured line input', async () => {
    let requestBody = ''
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? String(init.body) : ''
      return jsonResponse({ data: { orderFulfill: { fulfillments: [{ id: 'f_1', status: 'FULFILLED' }], errors: [] } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const lines = [
      { orderLineId: 'ol_1', stocks: [{ quantity: 2, warehouse: 'wh_1' }] },
    ]
    const result = await saleorConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.fulfill',
      args: { orderId: 'order_1', lines, notifyCustomer: true },
      idempotencyKey: 'k-fulfill',
    })

    const parsed = JSON.parse(requestBody) as {
      query: string
      variables: { order: string; input: { lines: unknown; notifyCustomer: boolean } }
    }
    expect(parsed.query).toContain('orderFulfill')
    expect(parsed.variables.order).toBe('order_1')
    expect(parsed.variables.input.lines).toEqual(lines)
    expect(parsed.variables.input.notifyCustomer).toBe(true)
    expect(result.status).toBe('committed')
  })
})

describe('saleor orders.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs an orderRefund mutation with the amount variable', async () => {
    let requestBody = ''
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? String(init.body) : ''
      return jsonResponse({ data: { orderRefund: { order: { id: 'order_1', paymentStatus: 'REFUNDED' }, errors: [] } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await saleorConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.refund',
      args: { orderId: 'order_1', amount: 49.99 },
      idempotencyKey: 'k-refund',
    })

    const parsed = JSON.parse(requestBody) as { query: string; variables: { id: string; amount: number } }
    expect(parsed.query).toContain('orderRefund')
    expect(parsed.variables).toEqual({ id: 'order_1', amount: 49.99 })
    expect(result.status).toBe('committed')
  })
})

describe('saleor orders.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs an orderUpdate mutation passing the structured input through', async () => {
    let requestBody = ''
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? String(init.body) : ''
      return jsonResponse({ data: { orderUpdate: { order: { id: 'order_1', status: 'UNCONFIRMED' }, errors: [] } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const input = { userEmail: 'new@example.com', languageCode: 'EN' }
    const result = await saleorConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.update',
      args: { orderId: 'order_1', input },
      idempotencyKey: 'k-update',
    })

    const parsed = JSON.parse(requestBody) as {
      query: string
      variables: { id: string; input: Record<string, unknown> }
    }
    expect(parsed.query).toContain('orderUpdate')
    expect(parsed.variables).toEqual({ id: 'order_1', input })
    expect(result.status).toBe('committed')
  })
})
