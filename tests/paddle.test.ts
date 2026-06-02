import { afterEach, describe, expect, it, vi } from 'vitest'
import { paddleConnector } from '../src/connectors/adapters/paddle.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_paddle_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'paddle',
    label: 'paddle test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'paddle_secret' },
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

describe('paddle adapter manifest', () => {
  it('classifies itself as the crm category and exposes the paddle kind', () => {
    expect(paddleConnector.manifest.kind).toBe('paddle')
    expect(paddleConnector.manifest.category).toBe('crm')
    expect(paddleConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = paddleConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers customers, subscriptions, transactions, prices, and refund/pause lifecycle', () => {
    const names = paddleConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'customers.create',
        'customers.list',
        'customers.update',
        'prices.create',
        'subscriptions.cancel',
        'subscriptions.get',
        'subscriptions.pause',
        'subscriptions.update',
        'transactions.create',
        'transactions.refund',
      ].sort(),
    )
    const reads = paddleConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = paddleConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['customers.list', 'subscriptions.get'].sort())
    expect(mutations).toEqual(
      [
        'customers.create',
        'customers.update',
        'prices.create',
        'subscriptions.cancel',
        'subscriptions.pause',
        'subscriptions.update',
        'transactions.create',
        'transactions.refund',
      ].sort(),
    )
  })

  it('marks the new write capabilities as native-idempotency external-effect', () => {
    for (const name of [
      'customers.create',
      'customers.update',
      'prices.create',
      'transactions.refund',
      'subscriptions.pause',
    ]) {
      const cap = paddleConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('paddle customers.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /customers with email and forwarded args', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return jsonResponse({ data: { id: 'ctm_1', email: 'lex@example.com' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await paddleConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.create',
      args: { email: 'lex@example.com', name: 'Lex' },
      idempotencyKey: 'k-create',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.paddle.com/customers')
    const parsed = JSON.parse(requestBody) as Record<string, unknown>
    expect(parsed.email).toBe('lex@example.com')
    expect(parsed.name).toBe('Lex')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      paddleConnector.executeMutation!({
        source: source(),
        capabilityName: 'customers.create',
        args: { email: 'lex@example.com' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('paddle customers.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /customers/{customerId} with forwarded args', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ data: { id: 'ctm_1', name: 'Lex Updated' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await paddleConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.update',
      args: { customerId: 'ctm_1', name: 'Lex Updated' },
      idempotencyKey: 'k-update',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.paddle.com/customers/ctm_1')
    expect(result.status).toBe('committed')
  })
})

describe('paddle prices.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /prices with snake_case body', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return jsonResponse({ data: { id: 'pri_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await paddleConnector.executeMutation!({
      source: source(),
      capabilityName: 'prices.create',
      args: {
        description: 'Pro monthly',
        productId: 'pro_1',
        unitPrice: { amount: '1500', currency_code: 'USD' },
      },
      idempotencyKey: 'k-prices',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.paddle.com/prices')
    const parsed = JSON.parse(requestBody) as Record<string, unknown>
    expect(parsed.description).toBe('Pro monthly')
    expect(parsed.product_id).toBe('pro_1')
    expect(parsed.unit_price).toEqual({ amount: '1500', currency_code: 'USD' })
    expect(result.status).toBe('committed')
  })
})

describe('paddle transactions.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /adjustments with action=refund and transaction_id', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return jsonResponse({ data: { id: 'adj_1', action: 'refund' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await paddleConnector.executeMutation!({
      source: source(),
      capabilityName: 'transactions.refund',
      args: {
        transactionId: 'txn_1',
        reason: 'customer_request',
        items: [{ item_id: 'item_1', type: 'full' }],
      },
      idempotencyKey: 'k-refund',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.paddle.com/adjustments')
    const parsed = JSON.parse(requestBody) as Record<string, unknown>
    expect(parsed.action).toBe('refund')
    expect(parsed.transaction_id).toBe('txn_1')
    expect(parsed.reason).toBe('customer_request')
    expect(parsed.items).toEqual([{ item_id: 'item_1', type: 'full' }])
    expect(result.status).toBe('committed')
  })
})

describe('paddle subscriptions.pause', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /subscriptions/{subscriptionId}/pause', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ data: { id: 'sub_1', status: 'paused' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await paddleConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.pause',
      args: { subscriptionId: 'sub_1' },
      idempotencyKey: 'k-pause',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.paddle.com/subscriptions/sub_1/pause')
    expect(result.status).toBe('committed')
  })
})
