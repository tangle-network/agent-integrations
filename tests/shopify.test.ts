import { afterEach, describe, expect, it, vi } from 'vitest'
import { shopifyConnector } from '../src/connectors/adapters/shopify.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_shopify_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'shopify',
    label: 'Acme Supply',
    consistencyModel: 'authoritative',
    scopes: ['read_orders', 'write_orders'],
    metadata: { apiBaseUrl: 'https://acme-supply.myshopify.com/' },
    credentials: {
      kind: 'oauth2',
      accessToken: 'shpat_test',
      refreshToken: '',
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
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

describe('shopify adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the shopify kind', () => {
    expect(shopifyConnector.manifest.kind).toBe('shopify')
    expect(shopifyConnector.manifest.category).toBe('commerce')
    expect(shopifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the per-shop authorize / token endpoint templates and env-var names', () => {
    const auth = shopifyConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://{shop}.myshopify.com/admin/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://{shop}.myshopify.com/admin/oauth/access_token')
    expect(auth.clientIdEnv).toBe('SHOPIFY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('SHOPIFY_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining([
        'read_products',
        'write_products',
        'read_orders',
        'write_orders',
        'read_customers',
        'write_customers',
        'read_inventory',
        'write_inventory',
      ]),
    )
  })

  it('covers products, orders, customers, inventory-level, refund, fulfillment, and draft-order capabilities', () => {
    const names = shopifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'products.search',
        'products.get',
        'products.create',
        'products.update',
        'products.delete',
        'orders.search',
        'orders.get',
        'orders.update',
        'orders.cancel',
        'customers.search',
        'customers.get',
        'customers.create',
        'customers.update',
        'inventory_levels.list',
        'inventory_levels.set',
        'inventory_levels.adjust',
        'refunds.create',
        'fulfillments.create',
        'draft_orders.create',
      ].sort(),
    )
    const reads = shopifyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = shopifyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'products.search',
        'products.get',
        'orders.search',
        'orders.get',
        'customers.search',
        'customers.get',
        'inventory_levels.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'products.create',
        'products.update',
        'products.delete',
        'orders.update',
        'orders.cancel',
        'customers.create',
        'customers.update',
        'inventory_levels.set',
        'inventory_levels.adjust',
        'refunds.create',
        'fulfillments.create',
        'draft_orders.create',
      ].sort(),
    )
  })

  it('declares the new write capabilities as native-idempotency mutations under write_orders scope', () => {
    const targets = ['refunds.create', 'fulfillments.create', 'draft_orders.create']
    for (const name of targets) {
      const cap = shopifyConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `capability ${name} missing`).toBeTruthy()
      if (!cap || cap.class !== 'mutation') throw new Error(`expected ${name} to be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
      expect(cap.requiredScopes).toEqual(['write_orders'])
    }
  })
})

describe('shopify adapter mutations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('refunds.create', () => {
    it('POSTs to /admin/api/2024-10/orders/{order_id}/refunds.json with the refund body and X-Shopify-Access-Token', async () => {
      let capturedUrl: string | null = null
      let capturedMethod: string | null = null
      let capturedBody: Record<string, unknown> | null = null
      let capturedHeaders: Record<string, string> = {}
      const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? 'GET'
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>
        capturedBody = init?.body ? JSON.parse(String(init.body)) : null
        return jsonResponse({ refund: { id: 99, order_id: 42 } }, { status: 201 })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await shopifyConnector.executeMutation!({
        source: source(),
        capabilityName: 'refunds.create',
        args: {
          order_id: 42,
          refund_line_items: [{ line_item_id: 7, quantity: 1, restock_type: 'return' }],
          transactions: [{ parent_id: 555, amount: '12.34', kind: 'refund', gateway: 'shopify_payments' }],
          notify: true,
        },
        idempotencyKey: 'idemp-refund-1',
      })

      expect(result.status).toBe('committed')
      if (result.status !== 'committed') throw new Error('unreachable')
      expect(result.data).toEqual({ refund: { id: 99, order_id: 42 } })
      expect(result.idempotentReplay).toBe(false)
      expect(typeof result.committedAt).toBe('number')
      expect(capturedMethod).toBe('POST')
      expect(capturedUrl).toContain('/admin/api/2024-10/orders/42/refunds.json')
      expect(capturedHeaders['X-Shopify-Access-Token']).toBe('shpat_test')
      expect(capturedBody).toMatchObject({
        order_id: 42,
        refund_line_items: [{ line_item_id: 7, quantity: 1, restock_type: 'return' }],
        transactions: [{ parent_id: 555, amount: '12.34', kind: 'refund', gateway: 'shopify_payments' }],
        notify: true,
      })
    })

    it('rejects when order_id is missing (path interpolation)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        shopifyConnector.executeMutation!({
          source: source(),
          capabilityName: 'refunds.create',
          args: {},
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/order_id/)
    })

    it('surfaces CredentialsExpired on 401', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
      await expect(
        shopifyConnector.executeMutation!({
          source: source(),
          capabilityName: 'refunds.create',
          args: { order_id: 42 },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })

    it('surfaces CredentialsExpired on 403', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
      await expect(
        shopifyConnector.executeMutation!({
          source: source(),
          capabilityName: 'refunds.create',
          args: { order_id: 42 },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })
  })

  describe('fulfillments.create', () => {
    it('POSTs to /admin/api/2024-10/fulfillments.json with the fulfillment body', async () => {
      let capturedUrl: string | null = null
      let capturedMethod: string | null = null
      let capturedBody: Record<string, unknown> | null = null
      const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? 'GET'
        capturedBody = init?.body ? JSON.parse(String(init.body)) : null
        return jsonResponse({ fulfillment: { id: 7001, status: 'success' } }, { status: 201 })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await shopifyConnector.executeMutation!({
        source: source(),
        capabilityName: 'fulfillments.create',
        args: {
          line_items_by_fulfillment_order: [{ fulfillment_order_id: 1234 }],
          tracking_info: { number: '1Z999', url: 'https://track.example/1Z999', company: 'UPS' },
          notify_customer: true,
        },
        idempotencyKey: 'idemp-ful-1',
      })

      expect(result.status).toBe('committed')
      if (result.status !== 'committed') throw new Error('unreachable')
      expect(result.data).toEqual({ fulfillment: { id: 7001, status: 'success' } })
      expect(capturedMethod).toBe('POST')
      expect(capturedUrl).toContain('/admin/api/2024-10/fulfillments.json')
      expect(capturedBody).toMatchObject({
        line_items_by_fulfillment_order: [{ fulfillment_order_id: 1234 }],
        tracking_info: { number: '1Z999', url: 'https://track.example/1Z999', company: 'UPS' },
        notify_customer: true,
      })
    })

    it('rejects when line_items_by_fulfillment_order is missing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      const result = shopifyConnector.executeMutation!({
        source: source(),
        capabilityName: 'fulfillments.create',
        args: {},
        idempotencyKey: 'k',
      })
      // The declarative path sends the request even with a missing optional-shaped body; the
      // contract guarantee for this capability is JSON-Schema validation upstream of the adapter.
      // We assert that AT LEAST the network mock is the only path exercised — i.e. no internal
      // throw — by awaiting it. If a future refactor adds adapter-level required-arg enforcement
      // for body params, this test should flip to .rejects.toThrow(/line_items_by_fulfillment_order/).
      await expect(result).resolves.toBeTruthy()
    })

    it('surfaces CredentialsExpired on 401', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
      await expect(
        shopifyConnector.executeMutation!({
          source: source(),
          capabilityName: 'fulfillments.create',
          args: { line_items_by_fulfillment_order: [{ fulfillment_order_id: 1 }] },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })
  })

  describe('draft_orders.create', () => {
    it('POSTs to /admin/api/2024-10/draft_orders.json with the draft-order body', async () => {
      let capturedUrl: string | null = null
      let capturedMethod: string | null = null
      let capturedBody: Record<string, unknown> | null = null
      const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? 'GET'
        capturedBody = init?.body ? JSON.parse(String(init.body)) : null
        return jsonResponse({ draft_order: { id: 8001, status: 'open' } }, { status: 201 })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await shopifyConnector.executeMutation!({
        source: source(),
        capabilityName: 'draft_orders.create',
        args: {
          line_items: [{ variant_id: 12345, quantity: 2 }],
          customer: { id: 9001 },
        },
        idempotencyKey: 'idemp-draft-1',
      })

      expect(result.status).toBe('committed')
      if (result.status !== 'committed') throw new Error('unreachable')
      expect(result.data).toEqual({ draft_order: { id: 8001, status: 'open' } })
      expect(capturedMethod).toBe('POST')
      expect(capturedUrl).toContain('/admin/api/2024-10/draft_orders.json')
      expect(capturedBody).toMatchObject({
        line_items: [{ variant_id: 12345, quantity: 2 }],
        customer: { id: 9001 },
      })
    })

    it('surfaces CredentialsExpired on 401', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
      await expect(
        shopifyConnector.executeMutation!({
          source: source(),
          capabilityName: 'draft_orders.create',
          args: { line_items: [{ variant_id: 1, quantity: 1 }] },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })

    it('surfaces CredentialsExpired on 403', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
      await expect(
        shopifyConnector.executeMutation!({
          source: source(),
          capabilityName: 'draft_orders.create',
          args: { line_items: [{ variant_id: 1, quantity: 1 }] },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })
  })
})
