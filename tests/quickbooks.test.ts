import { afterEach, describe, expect, it, vi } from 'vitest'
import { quickbooksConnector } from '../src/connectors/adapters/quickbooks.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_quickbooks_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'quickbooks',
    label: 'quickbooks test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { apiBaseUrl: 'https://quickbooks.api.intuit.com/v3/company/9341' },
    credentials: { kind: 'oauth2', accessToken: 'qbo-token' },
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

describe('quickbooks adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the quickbooks kind', () => {
    expect(quickbooksConnector.manifest.kind).toBe('quickbooks')
    expect(quickbooksConnector.manifest.category).toBe('commerce')
    expect(quickbooksConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses OAuth2 with the documented Intuit endpoints and env-var names', () => {
    const auth = quickbooksConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://appcenter.intuit.com/connect/oauth2')
    expect(auth.tokenUrl).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer')
    expect(auth.clientIdEnv).toBe('QUICKBOOKS_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('QUICKBOOKS_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('com.intuit.quickbooks.accounting')
  })

  it('covers the original capability set plus the write-side extensions', () => {
    const names = quickbooksConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'entities.query',
        'customers.get',
        'customers.create',
        'customers.update',
        'customers.delete',
        'invoices.get',
        'invoices.create',
        'invoices.update',
        'invoices.delete',
        'invoices.send',
        'items.create',
        'payments.create',
        'bills.create',
        'vendors.create',
      ].sort(),
    )
  })

  it('marks every new write-side mutation as native-idempotency externalEffect', () => {
    const expectedExternal = new Set([
      'customers.delete',
      'invoices.delete',
      'invoices.send',
      'bills.create',
      'vendors.create',
    ])
    for (const c of quickbooksConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      if (!expectedExternal.has(c.name)) continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('quickbooks customers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs sparse Active=false to /customer (QBO has no hard delete)', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ Customer: { Id: '42', Active: false, SyncToken: '1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quickbooksConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.delete',
      args: { Id: '42', SyncToken: '0', sparse: true, Active: false },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v3/company/9341/customer')
    expect(String(requestUrl)).toContain('minorversion=70')
    expect(requestBody).toMatchObject({ Id: '42', SyncToken: '0', sparse: true, Active: false })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      quickbooksConnector.executeMutation!({
        source: source(),
        capabilityName: 'customers.delete',
        args: { Id: '42', SyncToken: '0' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('quickbooks invoices.delete (void)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /invoice with ?operation=void', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ Invoice: { Id: '7', status: 'Voided' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quickbooksConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.delete',
      args: { Id: '7', SyncToken: '2' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v3/company/9341/invoice')
    expect(String(requestUrl)).toContain('operation=void')
    expect(requestBody).toMatchObject({ Id: '7', SyncToken: '2' })
    expect(result.status).toBe('committed')
  })
})

describe('quickbooks invoices.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /invoice/{invoiceId}/send with optional sendTo query', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ Invoice: { Id: '7', EmailStatus: 'EmailSent' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quickbooksConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.send',
      args: { invoiceId: '7', sendTo: 'buyer@example.com' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    const url = String(requestUrl)
    expect(url).toContain('/v3/company/9341/invoice/7/send')
    expect(url).toContain('sendTo=buyer%40example.com')
    expect(result.status).toBe('committed')
  })

  it('omits sendTo when not provided', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return jsonResponse({ Invoice: { Id: '7' } })
      }),
    )

    await quickbooksConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.send',
      args: { invoiceId: '7' },
      idempotencyKey: 'k',
    })

    const url = String(requestUrl)
    expect(url).toContain('/v3/company/9341/invoice/7/send')
    expect(url).not.toContain('sendTo=')
  })
})

describe('quickbooks bills.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /bill with the args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ Bill: { Id: 'b_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await quickbooksConnector.executeMutation!({
      source: source(),
      capabilityName: 'bills.create',
      args: {
        VendorRef: { value: 'v_1' },
        Line: [{ DetailType: 'AccountBasedExpenseLineDetail', Amount: 100 }],
        TxnDate: '2026-06-02',
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v3/company/9341/bill')
    expect(requestBody).toMatchObject({
      VendorRef: { value: 'v_1' },
      TxnDate: '2026-06-02',
    })
  })
})

describe('quickbooks vendors.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /vendor with DisplayName + optional fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ Vendor: { Id: 'v_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await quickbooksConnector.executeMutation!({
      source: source(),
      capabilityName: 'vendors.create',
      args: {
        DisplayName: 'Acme Supplies',
        CompanyName: 'Acme Inc',
        PrimaryEmailAddr: { Address: 'ap@acme.example' },
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v3/company/9341/vendor')
    expect(requestBody).toMatchObject({
      DisplayName: 'Acme Supplies',
      CompanyName: 'Acme Inc',
    })
  })
})
