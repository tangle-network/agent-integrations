import { afterEach, describe, expect, it, vi } from 'vitest'
import { vtexConnector } from '../src/connectors/adapters/vtex.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_vtex_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'vtex',
    label: 'VTEX test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { hostUrl: 'https://example.vtexcommercestable.com.br' },
    credentials: { kind: 'api-key', apiKey: 'vtex_secret' },
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

describe('vtex adapter manifest', () => {
  it('classifies itself as the crm category and exposes the vtex kind', () => {
    expect(vtexConnector.manifest.kind).toBe('vtex')
    expect(vtexConnector.manifest.category).toBe('crm')
    expect(vtexConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = vtexConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/VTEX|App|Token/i)
  })

  it('covers brands, products, categories, skus, orders, and clients capability surface', () => {
    const names = vtexConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'brands.create',
        'brands.delete',
        'brands.get',
        'brands.list',
        'brands.update',
        'categories.create',
        'categories.get',
        'clients.get',
        'clients.list',
        'orders.cancel',
        'orders.get',
        'orders.list',
        'products.create',
        'products.delete',
        'products.get',
        'products.update',
        'skus.create',
        'skus.list',
        'skus.update',
      ].sort(),
    )
    const mutations = vtexConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'brands.create',
        'brands.delete',
        'brands.update',
        'categories.create',
        'orders.cancel',
        'products.create',
        'products.delete',
        'products.update',
        'skus.create',
        'skus.update',
      ].sort(),
    )
  })

  it('marks newly added mutations as native-idempotency externalEffect', () => {
    const newMutations = new Set([
      'products.delete',
      'categories.create',
      'orders.cancel',
    ])
    for (const cap of vtexConnector.manifest.capabilities) {
      if (!newMutations.has(cap.name)) continue
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('marks skus.update as externalEffect (optimistic-read-verify is acceptable)', () => {
    const cap = vtexConnector.manifest.capabilities.find((c) => c.name === 'skus.update')
    expect(cap?.class).toBe('mutation')
    if (cap?.class !== 'mutation') throw new Error('unreachable')
    expect(cap.externalEffect).toBe(true)
  })
})

describe('vtex write capabilities', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('products.delete issues DELETE on /api/catalog_system/v2.0/products/{productId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 99, deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vtexConnector.executeMutation!({
      source: source(),
      capabilityName: 'products.delete',
      args: { productId: 99 },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/catalog_system/v2.0/products/99')
  })

  it('categories.create POSTs to /api/catalog_system/v1.0/category with the supplied fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string | undefined
      return jsonResponse({ id: 42, name: 'New' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await vtexConnector.executeMutation!({
      source: source(),
      capabilityName: 'categories.create',
      args: { name: 'New' },
      idempotencyKey: 'k-2',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/catalog_system/v1.0/category')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed.name).toBe('New')
  })

  it('skus.update PUTs to /api/catalog_system/v2.0/skus/{skuId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 5, name: 'Updated SKU' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await vtexConnector.executeMutation!({
      source: source(),
      capabilityName: 'skus.update',
      args: { skuId: 5, name: 'Updated SKU' },
      idempotencyKey: 'k-3',
    })

    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/api/catalog_system/v2.0/skus/5')
  })

  it('orders.cancel POSTs to /api/oms/pvt/orders/{orderId}/cancel', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ orderId: 'ORD-1', status: 'canceled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await vtexConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.cancel',
      args: { orderId: 'ORD-1', reason: 'customer-request' },
      idempotencyKey: 'k-4',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/oms/pvt/orders/ORD-1/cancel')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )

    await expect(
      vtexConnector.executeMutation!({
        source: source(),
        capabilityName: 'products.delete',
        args: { productId: 99 },
        idempotencyKey: 'k-5',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
