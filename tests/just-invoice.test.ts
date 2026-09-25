import { afterEach, describe, expect, it, vi } from 'vitest'
import { justInvoiceConnector } from '../src/connectors/adapters/just-invoice.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_just_invoice_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'just-invoice',
    label: 'Acme JustInvoice',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'jv_test_key' },
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('just-invoice invoices.send', () => {
  it('POSTs to /invoices/{id}/send with email_to body and returns the vendor payload', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | null = null
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? 'GET'
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'inv_42', status: 'sent', sent_to: 'a@b.com' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await justInvoiceConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.send',
      args: { invoiceId: 'inv_42', email_to: 'a@b.com' },
      idempotencyKey: 'idemp-send-1',
    })

    expect(result.status).toBe('committed')
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/invoices/inv_42/send')
    expect(capturedBody).toEqual({ invoiceId: 'inv_42', email_to: 'a@b.com' })
    if (result.status === 'committed') {
      expect(result.data).toEqual({ id: 'inv_42', status: 'sent', sent_to: 'a@b.com' })
      expect(result.idempotentReplay).toBe(false)
      expect(typeof result.committedAt).toBe('number')
    }
  })

  it('rejects missing invoiceId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      justInvoiceConnector.executeMutation!({
        source: source(),
        capabilityName: 'invoices.send',
        args: { email_to: 'a@b.com' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/invoiceId/)
  })
})

describe('just-invoice invoices.markPaid', () => {
  it('POSTs to /invoices/{id}/mark-paid with paid_at body', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | null = null
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? 'GET'
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'inv_99', status: 'paid', paid_at: '2026-06-01' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await justInvoiceConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.markPaid',
      args: { invoiceId: 'inv_99', paid_at: '2026-06-01' },
      idempotencyKey: 'idemp-mp-1',
    })

    expect(result.status).toBe('committed')
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/invoices/inv_99/mark-paid')
    expect(capturedBody).toEqual({ invoiceId: 'inv_99', paid_at: '2026-06-01' })
    if (result.status === 'committed') {
      expect((result.data as { status: string }).status).toBe('paid')
    }
  })

  it('rejects missing invoiceId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      justInvoiceConnector.executeMutation!({
        source: source(),
        capabilityName: 'invoices.markPaid',
        args: { paid_at: '2026-06-01' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/invoiceId/)
  })
})

describe('just-invoice invoices.update', () => {
  it('PUTs to /invoices/{id} with the updatable fields the caller supplied', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | null = null
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? 'GET'
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'inv_7', status: 'sent', currencyCode: 'EUR' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await justInvoiceConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.update',
      args: {
        invoiceId: 'inv_7',
        currencyCode: 'EUR',
        invoiceStatus: 'sent',
        noteToCustomer: 'Thanks for your business',
      },
      idempotencyKey: 'idemp-upd-1',
    })

    expect(result.status).toBe('committed')
    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toContain('/invoices/inv_7')
    expect(capturedBody).toEqual({
      invoiceId: 'inv_7',
      currencyCode: 'EUR',
      invoiceStatus: 'sent',
      noteToCustomer: 'Thanks for your business',
    })
    if (result.status === 'committed') {
      expect((result.data as { id: string }).id).toBe('inv_7')
    }
  })

  it('rejects missing invoiceId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      justInvoiceConnector.executeMutation!({
        source: source(),
        capabilityName: 'invoices.update',
        args: { currencyCode: 'EUR' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/invoiceId/)
  })
})
