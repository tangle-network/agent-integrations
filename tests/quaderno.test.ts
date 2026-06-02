import { afterEach, describe, expect, it, vi } from 'vitest'
import { quadernoConnector } from '../src/connectors/adapters/quaderno.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_quaderno_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'quaderno',
    label: 'quaderno test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'quaderno_secret' },
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

describe('quaderno adapter manifest', () => {
  it('classifies itself as the crm category and exposes the quaderno kind', () => {
    expect(quadernoConnector.manifest.kind).toBe('quaderno')
    expect(quadernoConnector.manifest.category).toBe('crm')
    expect(quadernoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = quadernoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus the new write-side capabilities', () => {
    const names = quadernoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.find',
        'contacts.create',
        'contacts.update',
        'contacts.delete',
        'invoices.create',
        'invoices.update',
        'invoices.deliver',
        'credits.create',
        'expenses.create',
      ].sort(),
    )
    const reads = quadernoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = quadernoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.find'].sort())
    expect(mutations).toEqual(
      [
        'contacts.create',
        'contacts.update',
        'contacts.delete',
        'invoices.create',
        'invoices.update',
        'invoices.deliver',
        'credits.create',
        'expenses.create',
      ].sort(),
    )
  })

  it('marks every new write-side mutation as native-idempotency externalEffect', () => {
    const expectedExternal = new Set([
      'contacts.update',
      'contacts.delete',
      'invoices.update',
      'invoices.deliver',
      'credits.create',
    ])
    for (const c of quadernoConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      if (!expectedExternal.has(c.name)) continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('quaderno contacts.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /contacts/{contactId} with the renamed body fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'c_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quadernoConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.update',
      args: {
        contactId: 'c_1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        kind: 'person',
        country: 'ES',
        city: 'Madrid',
        postalCode: '28001',
        region: 'Madrid',
        streetLine1: 'Calle Mayor 1',
        streetLine2: '',
        taxId: 'ESX1234',
        taxStatus: 'eu_business',
        language: 'EN',
        phone: '+34111',
        website: 'https://example.com',
        discount: 0,
        notes: 'vip',
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/api/v1/contacts/c_1')
    expect(requestBody).toMatchObject({ first_name: 'Ada', tax_id: 'ESX1234' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401 from contacts.delete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      quadernoConnector.executeMutation!({
        source: source(),
        capabilityName: 'contacts.delete',
        args: { contactId: 'c_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('quaderno contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /contacts/{contactId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quadernoConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { contactId: 'c_99' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v1/contacts/c_99')
    expect(result.status).toBe('committed')
  })
})

describe('quaderno invoices.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /invoices/{invoiceId} with renamed body fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'inv_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await quadernoConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.update',
      args: {
        invoiceId: 'inv_1',
        invoiceNumber: 'A-001',
        dueDate: '2026-08-01',
        issueDate: '2026-06-02',
        currency: 'EUR',
        poNumber: 'PO-7',
        notes: 'late payment fee waived',
        tagList: 'priority',
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/api/v1/invoices/inv_1')
    expect(requestBody).toMatchObject({ number: 'A-001', due_date: '2026-08-01' })
  })
})

describe('quaderno invoices.deliver', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /invoices/{invoiceId}/deliver to trigger email delivery', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'delivered' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quadernoConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.deliver',
      args: { invoiceId: 'inv_1' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/api/v1/invoices/inv_1/deliver')
    expect(result.status).toBe('committed')
  })
})

describe('quaderno credits.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /credits with mapped contact and line_items', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'cred_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await quadernoConnector.executeMutation!({
      source: source(),
      capabilityName: 'credits.create',
      args: {
        customerFirstName: 'Ada',
        customerLastName: 'Lovelace',
        customerEmail: 'ada@example.com',
        customerCountry: 'ES',
        issueDate: '2026-06-02',
        currency: 'EUR',
        creditNumber: 'CN-001',
        poNumber: 'PO-7',
        notes: 'refund',
        itemDescription: 'Refund',
        itemQuantity: 1,
        itemUnitCost: '50.00',
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/credits')
    expect(requestBody).toMatchObject({
      currency: 'EUR',
      issued_at: '2026-06-02',
      contact: { first_name: 'Ada', country: 'ES' },
    })
  })
})
