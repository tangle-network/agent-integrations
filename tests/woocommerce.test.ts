import { afterEach, describe, expect, it, vi } from 'vitest'
import { woocommerceConnector } from '../src/connectors/adapters/woocommerce.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_woocommerce_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'woocommerce',
    label: 'WooCommerce test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { storeUrl: 'https://mystore.com' },
    credentials: { kind: 'api-key', apiKey: 'woocommerce_secret' },
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

describe('woocommerce write capabilities', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('customers.update issues PUT against the customer ID', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string | undefined
      return jsonResponse({ id: 42, email: 'new@example.com' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await woocommerceConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.update',
      args: { id: 42, email: 'new@example.com', firstName: 'Ada' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toBe('https://mystore.com/wp-json/wc/v3/customers/42')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed).toMatchObject({ id: 42, email: 'new@example.com', firstName: 'Ada' })
  })

  it('customers.delete sends DELETE with force/reassign query params when supplied', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await woocommerceConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.delete',
      args: { id: 7, force: true, reassign: 1 },
      idempotencyKey: 'k-2',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/wp-json/wc/v3/customers/7')
    expect(String(requestUrl)).toContain('force=true')
    expect(String(requestUrl)).toContain('reassign=1')
  })

  it('products.update issues PUT against the product ID via body: args', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body as string | undefined
      return jsonResponse({ id: 12, name: 'Updated' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await woocommerceConnector.executeMutation!({
      source: source(),
      capabilityName: 'products.update',
      args: { id: 12, name: 'Updated', price: 9.99 },
      idempotencyKey: 'k-3',
    })

    expect(String(requestUrl)).toBe('https://mystore.com/wp-json/wc/v3/products/12')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed).toMatchObject({ id: 12, name: 'Updated', price: 9.99 })
    // Optional fields stay absent.
    expect(parsed).not.toHaveProperty('regularPrice')
    expect(parsed).not.toHaveProperty('sku')
  })

  it('products.delete sends DELETE with force=true', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await woocommerceConnector.executeMutation!({
      source: source(),
      capabilityName: 'products.delete',
      args: { id: 99, force: true },
      idempotencyKey: 'k-4',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/wp-json/wc/v3/products/99')
    expect(String(requestUrl)).toContain('force=true')
  })

  it('orders.update-status sends PUT with only the status field in the body', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body as string | undefined
      return jsonResponse({ id: 5, status: 'completed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await woocommerceConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.update-status',
      args: { id: 5, status: 'completed' },
      idempotencyKey: 'k-5',
    })

    expect(String(requestUrl)).toBe('https://mystore.com/wp-json/wc/v3/orders/5')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed).toEqual({ status: 'completed' })
  })
})
