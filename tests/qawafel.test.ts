import { afterEach, describe, expect, it, vi } from 'vitest'
import { qawafelConnector } from '../src/connectors/adapters/qawafel.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_qawafel_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'qawafel',
    label: 'qawafel test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'qawafel_secret' },
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

describe('qawafel products.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/products/{product_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await qawafelConnector.executeMutation!({
      source: source(),
      capabilityName: 'products.delete',
      args: { product_id: 'p_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/products/p_42')
    expect(result.status).toBe('committed')
  })
})

describe('qawafel orders.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/orders/{order_id}/refund with the amount + reason body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'rf_1', status: 'refunded' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await qawafelConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.refund',
      args: { order_id: 'ord_7', amount: '50.00', reason: 'customer request' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/orders/ord_7/refund')
    expect(requestBody).toMatchObject({ amount: '50.00', reason: 'customer request', order_id: 'ord_7' })
    expect(result.status).toBe('committed')
  })
})

describe('qawafel invoices.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/invoices/{invoice_id} with the merged args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'inv_9' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await qawafelConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.update',
      args: { invoice_id: 'inv_9', notes: 'updated', due_date: '2026-07-01' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/invoices/inv_9')
    expect(requestBody).toMatchObject({ invoice_id: 'inv_9', notes: 'updated', due_date: '2026-07-01' })
  })
})

describe('qawafel invoices.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/invoices/{invoice_id}/send', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await qawafelConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.send',
      args: { invoice_id: 'inv_9', email: 'buyer@example.com' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/invoices/inv_9/send')
    expect(requestBody).toMatchObject({ email: 'buyer@example.com', invoice_id: 'inv_9' })
  })
})
