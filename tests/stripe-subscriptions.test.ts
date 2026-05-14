import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  stripePackConnector,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(): ResolvedDataSource {
  return {
    id: 'src_stripe_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'stripe-pack',
    label: 'Acme Stripe',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'rk_test_abc' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('stripe-pack subscriptions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest now includes subscription + billing portal capabilities', () => {
    const names = stripePackConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('list_subscriptions')
    expect(names).toContain('cancel_subscription')
    expect(names).toContain('create_billing_portal_session')
  })

  it('list_subscriptions filters by customer + status and shapes the response', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        data: [
          {
            id: 'sub_1',
            status: 'active',
            current_period_end: 1700000000,
            cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_1', product: 'prod_1', unit_amount: 1500, currency: 'usd', recurring: { interval: 'month' } } }] },
          },
        ],
      })
    }))
    const result = await stripePackConnector.executeRead!({
      source: source(),
      capabilityName: 'list_subscriptions',
      args: { customerId: 'cus_1', status: 'active' },
      idempotencyKey: 'k1',
    })
    expect(capturedUrl).toContain('customer=cus_1')
    expect(capturedUrl).toContain('status=active')
    const data = result.data as { subscriptions: Array<{ id: string; items: Array<{ priceId?: string }> }> }
    expect(data.subscriptions[0].id).toBe('sub_1')
    expect(data.subscriptions[0].items[0].priceId).toBe('price_1')
  })

  it('cancel_subscription with atPeriodEnd=true POSTs the update', async () => {
    let method: string | undefined
    let body: URLSearchParams | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      method = init?.method
      body = new URLSearchParams(init?.body as string)
      return jsonResponse({ id: 'sub_1', status: 'active', cancel_at_period_end: true, current_period_end: 1700000000 })
    }))
    const result = await stripePackConnector.executeMutation!({
      source: source(),
      capabilityName: 'cancel_subscription',
      args: { subscriptionId: 'sub_1', atPeriodEnd: true },
      idempotencyKey: 'k1',
    })
    expect(method).toBe('POST')
    expect(body!.get('cancel_at_period_end')).toBe('true')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { cancelAtPeriodEnd: boolean }).cancelAtPeriodEnd).toBe(true)
    }
  })

  it('cancel_subscription without atPeriodEnd performs a DELETE', async () => {
    let method: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      method = init?.method
      return jsonResponse({ id: 'sub_1', status: 'canceled', canceled_at: 1700000001 })
    }))
    const result = await stripePackConnector.executeMutation!({
      source: source(),
      capabilityName: 'cancel_subscription',
      args: { subscriptionId: 'sub_1' },
      idempotencyKey: 'k1',
    })
    expect(method).toBe('DELETE')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { status: string }).status).toBe('canceled')
    }
  })

  it('create_billing_portal_session returns the hosted URL', async () => {
    let idemHeader: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      idemHeader = headers['idempotency-key']
      return jsonResponse({ id: 'bps_1', url: 'https://billing.stripe.com/session/bps_1', return_url: 'https://app/acct' })
    }))
    const result = await stripePackConnector.executeMutation!({
      source: source(),
      capabilityName: 'create_billing_portal_session',
      args: { customerId: 'cus_1', returnUrl: 'https://app/acct' },
      idempotencyKey: 'k-portal-1',
    })
    expect(idemHeader).toBe('k-portal-1')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { url: string }).url).toBe('https://billing.stripe.com/session/bps_1')
    }
  })
})
