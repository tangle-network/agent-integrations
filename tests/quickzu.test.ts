import { afterEach, describe, expect, it, vi } from 'vitest'
import { quickzuConnector } from '../src/connectors/adapters/quickzu.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_quickzu_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'quickzu',
    label: 'quickzu test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'quickzu_secret' },
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

describe('quickzu adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the quickzu kind', () => {
    expect(quickzuConnector.manifest.kind).toBe('quickzu')
    expect(quickzuConnector.manifest.category).toBe('commerce')
    expect(quickzuConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = quickzuConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set plus write-side lifecycle mutations', () => {
    const names = quickzuConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'business.hours.update',
        'categories.list',
        'categories.create',
        'categories.update',
        'categories.delete',
        'categories.reorder',
        'products.list',
        'products.add',
        'products.update',
        'products.delete',
        'orders.list',
        'orders.live',
        'orders.get',
        'orders.update-status',
        'orders.cancel',
        'orders.refund',
        'discounts.create',
        'discounts.delete',
        'promo-codes.create',
        'promo-codes.delete',
      ].sort(),
    )
    const reads = quickzuConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = quickzuConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['categories.list', 'products.list', 'orders.list', 'orders.live', 'orders.get'].sort())
    expect(mutations).toEqual(
      [
        'business.hours.update',
        'categories.create',
        'categories.update',
        'categories.delete',
        'categories.reorder',
        'products.add',
        'products.update',
        'products.delete',
        'orders.update-status',
        'orders.cancel',
        'orders.refund',
        'discounts.create',
        'discounts.delete',
        'promo-codes.create',
        'promo-codes.delete',
      ].sort(),
    )
  })

  it('marks the new lifecycle mutations as native-idempotency external-effect', () => {
    for (const name of [
      'orders.cancel',
      'orders.refund',
      'discounts.delete',
      'promo-codes.delete',
      'categories.reorder',
    ]) {
      const cap = quickzuConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('quickzu orders.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /orders/{orderId}/cancel', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ id: 'order_1', status: 'cancelled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quickzuConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.cancel',
      args: { orderId: 'order_1' },
      idempotencyKey: 'k-cancel',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.quickzu.com/api/v1/orders/order_1/cancel')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      quickzuConnector.executeMutation!({
        source: source(),
        capabilityName: 'orders.cancel',
        args: { orderId: 'order_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('quickzu orders.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /orders/{orderId}/refund and passes args as the body', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? String(init.body) : ''
      return jsonResponse({ id: 'order_1', refunded: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quickzuConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.refund',
      args: { orderId: 'order_1', amount: 12.5, reason: 'damaged' },
      idempotencyKey: 'k-refund',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.quickzu.com/api/v1/orders/order_1/refund')
    expect(JSON.parse(requestBody)).toMatchObject({ amount: 12.5, reason: 'damaged' })
    expect(result.status).toBe('committed')
  })
})

describe('quickzu discounts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /discounts/product/{discountId}', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quickzuConnector.executeMutation!({
      source: source(),
      capabilityName: 'discounts.delete',
      args: { discountId: 'disc_1' },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.quickzu.com/api/v1/discounts/product/disc_1')
    expect(result.status).toBe('committed')
  })
})

describe('quickzu promo-codes.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /promo-codes/{promoCodeId}', async () => {
    let requestUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quickzuConnector.executeMutation!({
      source: source(),
      capabilityName: 'promo-codes.delete',
      args: { promoCodeId: 'promo_1' },
      idempotencyKey: 'k-del',
    })

    expect(requestUrl).toBe('https://api.quickzu.com/api/v1/promo-codes/promo_1')
    expect(result.status).toBe('committed')
  })
})

describe('quickzu categories.reorder', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs the new category order to /categories/reorder', async () => {
    let requestMethod = ''
    let requestUrl = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? String(init.body) : ''
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quickzuConnector.executeMutation!({
      source: source(),
      capabilityName: 'categories.reorder',
      args: { categoryIds: ['c_1', 'c_2', 'c_3'] },
      idempotencyKey: 'k-reorder',
    })

    expect(requestMethod).toBe('PUT')
    expect(requestUrl).toBe('https://api.quickzu.com/api/v1/categories/reorder')
    expect(JSON.parse(requestBody)).toEqual({ categoryIds: ['c_1', 'c_2', 'c_3'] })
    expect(result.status).toBe('committed')
  })
})
