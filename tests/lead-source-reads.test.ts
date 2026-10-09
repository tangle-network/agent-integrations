import { afterEach, describe, expect, it, vi } from 'vitest'
import { hubspot, stripePackConnector, type ResolvedDataSource } from '../src/connectors/index'

function source(kind: string, credentials: ResolvedDataSource['credentials']): ResolvedDataSource {
  return {
    id: `src_${kind}`, projectId: 'proj_1', publishedAgentId: null, kind, label: kind,
    consistencyModel: 'authoritative', scopes: [], metadata: {}, credentials, status: 'active',
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('stripe-pack signup events', () => {
  it('lists the three signup event types since a time, oldest first, with only the customer fields a lead needs', async () => {
    const fetchMock = vi.fn(async () => json({
      has_more: false,
      data: [
        { id: 'evt_3', type: 'customer.subscription.created', created: 300, livemode: true,
          data: { object: { id: 'sub_1', object: 'subscription', customer: 'cus_2', status: 'trialing', trial_end: 900 } } },
        { id: 'evt_2', type: 'checkout.session.completed', created: 200, livemode: true,
          data: { object: { id: 'cs_1', object: 'checkout.session', customer: 'cus_2', amount_total: 4900, currency: 'usd', mode: 'subscription',
            customer_details: { email: 'buyer@startup.dev', name: 'Bo Buyer', address: { line1: 'private' } } } } },
        { id: 'evt_1', type: 'customer.created', created: 100, livemode: true,
          data: { object: { id: 'cus_1', object: 'customer', email: 'ada@engines.io', name: 'Ada', phone: '+15550100' } } },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await stripePackConnector.executeRead!({
      source: source('stripe-pack', { kind: 'api-key', apiKey: 'rk_test_abc' }),
      capabilityName: 'list_signup_events', args: { createdGte: 50, limit: 25 }, idempotencyKey: 'k1',
    })
    const url = new URL(String((fetchMock.mock.calls[0] as unknown as [string])[0]))
    expect(url.pathname).toBe('/v1/events')
    expect(url.searchParams.getAll('types[]')).toEqual(['customer.created', 'checkout.session.completed', 'customer.subscription.created'])
    expect(url.searchParams.get('created[gte]')).toBe('50')
    expect(url.searchParams.get('limit')).toBe('25')
    const data = result.data as { events: Array<Record<string, unknown>>; hasMore: boolean }
    expect(data.events.map((event) => event.id)).toEqual(['evt_1', 'evt_2', 'evt_3'])
    expect(data.events[0]).toEqual({ id: 'evt_1', type: 'customer.created', created: 100, livemode: true,
      customer: { id: 'cus_1', email: 'ada@engines.io', name: 'Ada' } })
    expect(data.events[1]).toMatchObject({ customer: { id: 'cus_2', email: 'buyer@startup.dev', name: 'Bo Buyer' },
      checkout: { id: 'cs_1', amountTotal: 4900, currency: 'usd', mode: 'subscription' } })
    expect(data.events[2]).toMatchObject({ customer: { id: 'cus_2', email: null }, subscription: { id: 'sub_1', status: 'trialing', trialEnd: 900 } })
    expect(JSON.stringify(data)).not.toContain('private')
    expect(JSON.stringify(data)).not.toContain('+15550100')
  })

  it('refuses event types outside the signup set and customer ids that are not cus_ ids', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const run = (capabilityName: string, args: Record<string, unknown>) => stripePackConnector.executeRead!({
      source: source('stripe-pack', { kind: 'api-key', apiKey: 'rk_test_abc' }), capabilityName, args, idempotencyKey: 'k2' })
    await expect(run('list_signup_events', { types: ['charge.refunded'] })).rejects.toThrow('unsupported event types')
    await expect(run('retrieve_customer', { customerId: '../account' })).rejects.toThrow('cus_ id')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads one customer for a subscription event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'cus_2', object: 'customer', email: 'bo@startup.dev', name: 'Bo', created: 150 })))
    const result = await stripePackConnector.executeRead!({
      source: source('stripe-pack', { kind: 'api-key', apiKey: 'rk_test_abc' }), capabilityName: 'retrieve_customer', args: { customerId: 'cus_2' }, idempotencyKey: 'k3' })
    expect(result.data).toEqual({ found: true, customer: { id: 'cus_2', email: 'bo@startup.dev', name: 'Bo', created: 150 } })
  })
})

describe('hubspot new contacts', () => {
  it('searches contacts created since a time, oldest first, and returns a paging cursor', async () => {
    const fetchMock = vi.fn(async () => json({
      results: [{ id: '101', properties: { email: 'grace@navy.example', firstname: 'Grace', lastname: 'Hopper', company: 'Navy',
        jobtitle: 'Rear Admiral', lifecyclestage: 'lead', hs_analytics_source: 'ORGANIC_SEARCH', createdate: '2026-10-09T10:00:00.000Z' } }],
      paging: { next: { after: '101' } },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const connector = hubspot({ clientId: 'cid', clientSecret: 'sec' })
    const result = await connector.executeRead!({
      source: source('hubspot', { kind: 'oauth2', accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 }),
      capabilityName: 'list_new_contacts', args: { createdAfter: '2026-10-09T09:00:00.000Z', limit: 10 }, idempotencyKey: 'k4',
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/contacts/search')
    expect(JSON.parse(String(init.body))).toMatchObject({
      filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(Date.parse('2026-10-09T09:00:00.000Z')) }] }],
      sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
      limit: 10,
    })
    expect(result.data).toEqual({ after: '101', contacts: [{ id: '101', email: 'grace@navy.example', name: 'Grace Hopper', company: 'Navy',
      jobTitle: 'Rear Admiral', lifecycleStage: 'lead', source: 'ORGANIC_SEARCH', createdAt: '2026-10-09T10:00:00.000Z' }] })
  })
})
