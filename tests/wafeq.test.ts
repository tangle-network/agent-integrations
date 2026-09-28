import { afterEach, describe, expect, it, vi } from 'vitest'
import { wafeqConnector } from '../src/connectors/adapters/wafeq.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_wafeq_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'wafeq',
    label: 'Wafeq test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'wafeq_secret' },
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

describe('wafeq delete capabilities', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('contacts.delete issues DELETE on /contacts/{contact_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await wafeqConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { contact_id: 'con_1' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/contacts/con_1')
  })

  it('invoices.delete issues DELETE on /invoices/{invoice_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await wafeqConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.delete',
      args: { invoice_id: 'inv_1' },
      idempotencyKey: 'k-2',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/invoices/inv_1')
  })

  it('bills.delete issues DELETE on /bills/{bill_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await wafeqConnector.executeMutation!({
      source: source(),
      capabilityName: 'bills.delete',
      args: { bill_id: 'bill_1' },
      idempotencyKey: 'k-3',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/bills/bill_1')
  })

  it('items.delete issues DELETE on /items/{item_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await wafeqConnector.executeMutation!({
      source: source(),
      capabilityName: 'items.delete',
      args: { item_id: 'item_1' },
      idempotencyKey: 'k-4',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/items/item_1')
  })
})
