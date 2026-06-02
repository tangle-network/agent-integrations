import { afterEach, describe, expect, it, vi } from 'vitest'
import { stripeConnector } from '../src/connectors/adapters/stripe.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_stripe_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'stripe',
    label: 'Stripe test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'sk_test_secret' },
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

describe('stripe adapter manifest', () => {
  it('classifies itself as the crm category and exposes the stripe kind', () => {
    expect(stripeConnector.manifest.kind).toBe('stripe')
    expect(stripeConnector.manifest.category).toBe('crm')
    expect(stripeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('exposes api-key auth', () => {
    expect(stripeConnector.manifest.auth.kind).toBe('api-key')
  })

  it('declares capabilities', () => {
    expect(stripeConnector.manifest.capabilities.length).toBeGreaterThan(0)
    const capabilityNames = stripeConnector.manifest.capabilities.map((cap) => cap.name)
    expect(capabilityNames).toContain('customers.create')
    expect(capabilityNames).toContain('customers.retrieve')
    expect(capabilityNames).toContain('invoices.create')
    expect(capabilityNames).toContain('subscriptions.create')
    expect(capabilityNames).toContain('payment-intents.create')
  })

  it('exposes the new write capabilities', () => {
    const names = stripeConnector.manifest.capabilities.map((cap) => cap.name)
    expect(names).toContain('customers.delete')
    expect(names).toContain('invoices.send')
    expect(names).toContain('invoices.void')
    expect(names).toContain('products.update')
    expect(names).toContain('charges.capture')
  })

  it('marks the new mutations as native-idempotency externalEffect', () => {
    const newMutations = new Set([
      'customers.delete',
      'invoices.send',
      'invoices.void',
      'products.update',
      'charges.capture',
    ])
    for (const cap of stripeConnector.manifest.capabilities) {
      if (!newMutations.has(cap.name)) continue
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('stripe write capabilities', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('customers.delete issues DELETE on /customers/{customerId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'cus_123', deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await stripeConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.delete',
      args: { customerId: 'cus_123' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/customers/cus_123')
  })

  it('invoices.send POSTs to /invoices/{invoiceId}/send', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'in_123', status: 'open' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await stripeConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.send',
      args: { invoiceId: 'in_123' },
      idempotencyKey: 'k-2',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/invoices/in_123/send')
  })

  it('invoices.void POSTs to /invoices/{invoiceId}/void', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'in_123', status: 'void' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await stripeConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.void',
      args: { invoiceId: 'in_123' },
      idempotencyKey: 'k-3',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/invoices/in_123/void')
  })

  it('products.update POSTs to /products/{productId} with the supplied fields', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body as string | undefined
      return jsonResponse({ id: 'prod_123', name: 'Renamed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await stripeConnector.executeMutation!({
      source: source(),
      capabilityName: 'products.update',
      args: { productId: 'prod_123', name: 'Renamed', active: false },
      idempotencyKey: 'k-4',
    })

    expect(String(requestUrl)).toContain('/v1/products/prod_123')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed.name).toBe('Renamed')
    expect(parsed.active).toBe(false)
  })

  it('charges.capture POSTs to /charges/{chargeId}/capture', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'ch_123', captured: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await stripeConnector.executeMutation!({
      source: source(),
      capabilityName: 'charges.capture',
      args: { chargeId: 'ch_123', amount: 500 },
      idempotencyKey: 'k-5',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/charges/ch_123/capture')
  })

  it('surfaces CredentialsExpired on 401 from a new write capability', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )

    await expect(
      stripeConnector.executeMutation!({
        source: source(),
        capabilityName: 'customers.delete',
        args: { customerId: 'cus_123' },
        idempotencyKey: 'k-6',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('stripe webhook + events capabilities', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exposes webhooks.subscribe and events.list (events.replay skipped — no public Stripe API)', () => {
    const names = stripeConnector.manifest.capabilities.map((cap) => cap.name)
    expect(names).toContain('webhooks.subscribe')
    expect(names).toContain('events.list')
  })

  it('webhooks.subscribe is a mutation marked native-idempotency + externalEffect', () => {
    const cap = stripeConnector.manifest.capabilities.find((c) => c.name === 'webhooks.subscribe')
    if (!cap) throw new Error('webhooks.subscribe missing')
    expect(cap.class).toBe('mutation')
    if (cap.class !== 'mutation') throw new Error('unreachable')
    expect(cap.cas).toBe('native-idempotency')
    expect(cap.externalEffect).toBe(true)
  })

  it('events.list is a read', () => {
    const cap = stripeConnector.manifest.capabilities.find((c) => c.name === 'events.list')
    if (!cap) throw new Error('events.list missing')
    expect(cap.class).toBe('read')
  })

  it('webhooks.subscribe POSTs /webhook_endpoints with url + enabled_events', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string | undefined
      return jsonResponse({ id: 'we_123', secret: 'whsec_test' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await stripeConnector.executeMutation!({
      source: source(),
      capabilityName: 'webhooks.subscribe',
      args: {
        url: 'https://example.com/hook',
        enabled_events: ['invoice.payment_failed', 'customer.subscription.deleted'],
        description: 'test endpoint',
      },
      idempotencyKey: 'k-w1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/webhook_endpoints')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed.url).toBe('https://example.com/hook')
    expect(parsed.enabled_events).toEqual(['invoice.payment_failed', 'customer.subscription.deleted'])
    expect(parsed.description).toBe('test endpoint')
  })

  it('events.list GETs /events and forwards filter params', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ object: 'list', data: [{ id: 'evt_1', type: 'invoice.payment_failed' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await stripeConnector.executeRead!({
      source: source(),
      capabilityName: 'events.list',
      args: { type: 'invoice.payment_failed', limit: 25, createdGte: 1717200000 },
      idempotencyKey: 'k-events-list-1',
    })

    expect(result.data).toBeTruthy()
    expect(requestMethod).toBe('GET')
    const url = new URL(String(requestUrl))
    expect(url.pathname).toContain('/v1/events')
    expect(url.searchParams.get('type')).toBe('invoice.payment_failed')
    expect(url.searchParams.get('limit')).toBe('25')
    expect(url.searchParams.get('created[gte]')).toBe('1717200000')
  })

  it('events.list works with no filters (all fields optional)', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ object: 'list', data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await stripeConnector.executeRead!({
      source: source(),
      capabilityName: 'events.list',
      args: {},
      idempotencyKey: 'k-events-list-2',
    })

    const url = new URL(String(requestUrl))
    expect(url.pathname).toContain('/v1/events')
    // Optional params with no value must not be sent.
    expect(url.searchParams.has('type')).toBe(false)
    expect(url.searchParams.has('limit')).toBe(false)
  })
})
