import { afterEach, describe, expect, it, vi } from 'vitest'
import { squareConnector } from '../src/connectors/adapters/square.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_square_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'square',
    label: 'square test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'square_token' },
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

describe('square adapter manifest', () => {
  it('classifies itself as crm category and exposes the square kind', () => {
    expect(squareConnector.manifest.kind).toBe('square')
    expect(squareConnector.manifest.category).toBe('crm')
    expect(squareConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with Square OAuth endpoints', () => {
    const auth = squareConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/connect\.squareup\.com/)
    expect(auth.tokenUrl).toMatch(/connect\.squareup\.com/)
  })

  it('covers customers, payments, invoices, and catalog capability surface', () => {
    const names = squareConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('customers.list')
    expect(names).toContain('customers.get')
    expect(names).toContain('customers.create')
    expect(names).toContain('customers.update')
    expect(names).toContain('customers.delete')
    expect(names).toContain('payments.list')
    expect(names).toContain('payments.get')
    expect(names).toContain('payments.refund')
    expect(names).toContain('invoices.list')
    expect(names).toContain('invoices.get')
    expect(names).toContain('invoices.create')
    expect(names).toContain('invoices.update')
    expect(names).toContain('invoices.delete')
    expect(names).toContain('invoices.publish')
    expect(names).toContain('catalog.upsertItem')
  })

  it('marks mutations for create, update, delete, publish, refund, and upsert operations', () => {
    const mutations = squareConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('customers.create')
    expect(mutations).toContain('customers.update')
    expect(mutations).toContain('customers.delete')
    expect(mutations).toContain('invoices.create')
    expect(mutations).toContain('invoices.update')
    expect(mutations).toContain('invoices.delete')
    expect(mutations).toContain('invoices.publish')
    expect(mutations).toContain('payments.refund')
    expect(mutations).toContain('catalog.upsertItem')
  })

  it('marks read-only operations as read', () => {
    const reads = squareConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('customers.list')
    expect(reads).toContain('customers.get')
    expect(reads).toContain('payments.list')
    expect(reads).toContain('payments.get')
    expect(reads).toContain('invoices.list')
    expect(reads).toContain('invoices.get')
  })

  it('marks every mutation as native-idempotency + externalEffect=true (or optimistic-read-verify for update-style)', () => {
    const mutations = squareConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const cap of mutations) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(['native-idempotency', 'optimistic-read-verify', 'etag-if-match']).toContain(cap.cas)
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('marks every new write-side mutation as native-idempotency + externalEffect=true', () => {
    const newMutations = new Set([
      'customers.delete',
      'invoices.delete',
      'invoices.publish',
      'payments.refund',
      'catalog.upsertItem',
    ])
    const caps = squareConnector.manifest.capabilities.filter(
      (c) => newMutations.has(c.name) && c.class === 'mutation',
    )
    expect(caps.length).toBe(newMutations.size)
    for (const cap of caps) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('square customers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v2/customers/{customerId} with bearer auth', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let authHeader: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      const headers = init?.headers as Record<string, string> | undefined
      authHeader = headers?.authorization
      return jsonResponse({}, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await squareConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.delete',
      args: { customerId: 'cust_abc' },
      idempotencyKey: 'k-del-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v2/customers/cust_abc')
    expect(authHeader).toBe('Bearer square_token')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      squareConnector.executeMutation!({
        source: source(),
        capabilityName: 'customers.delete',
        args: { customerId: 'cust_abc' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('square invoices.publish', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/invoices/{invoiceId}/publish with the version in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ invoice: { id: 'inv_1', status: 'UNPAID' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await squareConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.publish',
      args: { invoiceId: 'inv_1', version: 3 },
      idempotencyKey: 'k-pub-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v2/invoices/inv_1/publish')
    expect(requestBody).toMatchObject({ version: 3 })
  })
})

describe('square payments.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/refunds with the full refund body', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ refund: { id: 'rf_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await squareConnector.executeMutation!({
      source: source(),
      capabilityName: 'payments.refund',
      args: {
        idempotency_key: 'rk-1',
        payment_id: 'pay_1',
        amount_money: { amount: 500, currency: 'USD' },
        reason: 'customer requested',
      },
      idempotencyKey: 'k-rf-1',
    })

    expect(String(requestUrl)).toContain('/v2/refunds')
    expect(requestBody).toMatchObject({
      idempotency_key: 'rk-1',
      payment_id: 'pay_1',
      amount_money: { amount: 500, currency: 'USD' },
    })
  })
})

describe('square catalog.upsertItem', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/catalog/object with the catalog object envelope', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ catalog_object: { id: 'cat_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await squareConnector.executeMutation!({
      source: source(),
      capabilityName: 'catalog.upsertItem',
      args: {
        idempotency_key: 'ck-1',
        object: { type: 'ITEM', id: '#item', item_data: { name: 'Widget' } },
      },
      idempotencyKey: 'k-cat-1',
    })

    expect(String(requestUrl)).toContain('/v2/catalog/object')
    expect(requestBody).toMatchObject({
      idempotency_key: 'ck-1',
      object: { type: 'ITEM', id: '#item' },
    })
  })
})
