import { afterEach, describe, expect, it, vi } from 'vitest'
import { xeroConnector } from '../src/connectors/adapters/xero.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_xero_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'xero',
    label: 'xero test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'xero_access_token',
      refreshToken: 'xero_refresh_token',
      expiresAt: Date.now() + 60_000,
    },
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

describe('xero adapter manifest', () => {
  it('exposes the xero kind in the crm category', () => {
    expect(xeroConnector.manifest.kind).toBe('xero')
    expect(xeroConnector.manifest.category).toBe('crm')
    expect(xeroConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth', () => {
    expect(xeroConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('covers the new write-side capabilities', () => {
    const names = xeroConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('contacts.archive')
    expect(names).toContain('invoices.delete')
    expect(names).toContain('invoices.email')
    expect(names).toContain('payments.create')
    expect(names).toContain('credit-notes.create')
  })

  it('marks new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = [
      'contacts.archive',
      'invoices.delete',
      'invoices.email',
      'payments.create',
      'credit-notes.create',
    ]
    for (const name of expected) {
      const cap = xeroConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('xero contacts.archive', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api.xro/2.0/Contacts/{contactId} with ContactStatus=ARCHIVED and tenant header', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    let tenantHeader: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      const headers = new Headers(init?.headers as HeadersInit | undefined)
      tenantHeader = headers.get('xero-tenant-id') ?? undefined
      return jsonResponse({ Contacts: [{ ContactID: 'c1', ContactStatus: 'ARCHIVED' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await xeroConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.archive',
      args: { tenantId: 'tenant_1', contactId: 'c1' },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.xero.com/api.xro/2.0/Contacts/c1')
    expect(requestBody).toEqual({ ContactStatus: 'ARCHIVED' })
    expect(tenantHeader).toBe('tenant_1')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      xeroConnector.executeMutation!({
        source: source(),
        capabilityName: 'contacts.archive',
        args: { tenantId: 't', contactId: 'c1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('xero invoices.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api.xro/2.0/Invoices/{invoiceId} with the requested Status', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ Invoices: [{ InvoiceID: 'i1', Status: 'VOIDED' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await xeroConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.delete',
      args: { tenantId: 'tenant_1', invoiceId: 'i1', status: 'VOIDED' },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.xero.com/api.xro/2.0/Invoices/i1')
    expect(requestBody).toEqual({ Status: 'VOIDED' })
  })
})

describe('xero invoices.email', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api.xro/2.0/Invoices/{invoiceId}/Email with empty body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await xeroConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.email',
      args: { tenantId: 'tenant_1', invoiceId: 'i1' },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.xero.com/api.xro/2.0/Invoices/i1/Email')
    expect(requestBody).toEqual({})
  })
})

describe('xero payments.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api.xro/2.0/Payments with the Payments envelope', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ Payments: [{ PaymentID: 'p1' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const payments = [
      {
        Invoice: { InvoiceID: 'i1' },
        Account: { Code: '090' },
        Date: '2024-01-15',
        Amount: 150.0,
      },
    ]

    await xeroConnector.executeMutation!({
      source: source(),
      capabilityName: 'payments.create',
      args: { tenantId: 'tenant_1', Payments: payments },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.xero.com/api.xro/2.0/Payments')
    expect(requestBody).toEqual({ Payments: payments })
  })
})

describe('xero credit-notes.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api.xro/2.0/CreditNotes with the CreditNotes envelope', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ CreditNotes: [{ CreditNoteID: 'cn1' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const creditNotes = [
      {
        Type: 'ACCRECCREDIT',
        Contact: { ContactID: 'c1' },
        LineItems: [{ Description: 'Refund', Quantity: 1, UnitAmount: 50 }],
        Date: '2024-01-15',
        Status: 'AUTHORISED',
      },
    ]

    await xeroConnector.executeMutation!({
      source: source(),
      capabilityName: 'credit-notes.create',
      args: { tenantId: 'tenant_1', CreditNotes: creditNotes },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.xero.com/api.xro/2.0/CreditNotes')
    expect(requestBody).toEqual({ CreditNotes: creditNotes })
  })
})
