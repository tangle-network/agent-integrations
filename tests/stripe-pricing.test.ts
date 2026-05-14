import { describe, expect, it } from 'vitest'
import {
  createBillingPortalUrl,
  createCheckoutUrl,
  findPlan,
  requirePlan,
  type PricingPlan,
} from '../src/stripe/pricing'
import { buildStripeClient } from '../src/stripe/tenant-config'

const plans: PricingPlan[] = [
  {
    id: 'pro',
    name: 'Pro',
    monthlyUsd: 29,
    yearlyUsd: 290,
    features: [{ label: 'unlimited', included: true }],
    stripePriceIds: { monthly: 'price_pro_m', yearly: 'price_pro_y' },
    trialDays: 14,
  },
  {
    id: 'starter',
    name: 'Starter',
    monthlyUsd: 9,
    yearlyUsd: null,
    features: [],
    stripePriceIds: { monthly: 'price_starter_m' },
  },
]

describe('findPlan / requirePlan', () => {
  it('finds by id', () => {
    expect(findPlan(plans, 'pro')?.name).toBe('Pro')
    expect(findPlan(plans, 'missing')).toBeNull()
  })

  it('requirePlan throws on missing', () => {
    expect(() => requirePlan(plans, 'missing')).toThrow(/unknown plan id/)
  })
})

describe('createCheckoutUrl', () => {
  function clientWithCapture(captured: { body?: string; headers?: Record<string, string>; url?: string }) {
    let _body = ''
    return {
      client: {
        productId: 'legal' as const,
        config: {
          productId: 'legal' as const,
          secretKey: 'sk',
          webhookSecret: 'wh',
          successUrl: 'https://app/success',
          cancelUrl: 'https://app/cancel',
        },
        async get<T>() {
          throw new Error('unused')
          return null as T
        },
        async mutate<T>(
          _method: 'POST' | 'DELETE',
          path: string,
          body: Record<string, string | number | boolean | undefined>,
          idempotencyKey: string,
        ) {
          captured.url = path
          captured.headers = { 'idempotency-key': idempotencyKey }
          const form = new URLSearchParams()
          for (const [k, v] of Object.entries(body)) {
            if (v === undefined) continue
            form.set(k, String(v))
          }
          _body = form.toString()
          captured.body = _body
          return { id: 'cs_x', url: 'https://stripe/cs_x' } as unknown as T
        },
      },
    }
  }

  it('writes workspaceId into BOTH session metadata and subscription_data metadata (load-bearing for webhook routing)', async () => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    await createCheckoutUrl(client, {
      workspaceId: 'ws_1',
      plan: plans[0],
      billing: 'monthly',
      idempotencyKey: 'idem_pro_m_ws_1',
    })
    const params = new URLSearchParams(captured.body)
    expect(params.get('metadata[workspaceId]')).toBe('ws_1')
    expect(params.get('subscription_data[metadata][workspaceId]')).toBe('ws_1')
    expect(params.get('metadata[planId]')).toBe('pro')
    expect(params.get('subscription_data[metadata][planId]')).toBe('pro')
  })

  it('threads through caller metadata into both maps', async () => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    await createCheckoutUrl(client, {
      workspaceId: 'ws_2',
      plan: plans[0],
      billing: 'monthly',
      idempotencyKey: 'idem',
      metadata: { campaign: 'launch-q1' },
    })
    const params = new URLSearchParams(captured.body)
    expect(params.get('metadata[campaign]')).toBe('launch-q1')
    expect(params.get('subscription_data[metadata][campaign]')).toBe('launch-q1')
  })

  it('uses plan.trialDays when no per-call override', async () => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    await createCheckoutUrl(client, {
      workspaceId: 'ws',
      plan: plans[0],
      billing: 'monthly',
      idempotencyKey: 'i',
    })
    expect(new URLSearchParams(captured.body).get('subscription_data[trial_period_days]')).toBe('14')
  })

  it('per-call trialDays beats plan.trialDays', async () => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    await createCheckoutUrl(client, {
      workspaceId: 'ws',
      plan: plans[0],
      billing: 'monthly',
      idempotencyKey: 'i',
      trialDays: 30,
    })
    expect(new URLSearchParams(captured.body).get('subscription_data[trial_period_days]')).toBe('30')
  })

  it('throws when the plan has no price for the requested cadence', async () => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    await expect(
      createCheckoutUrl(client, {
        workspaceId: 'ws',
        plan: plans[1], // starter has no yearly price
        billing: 'yearly',
        idempotencyKey: 'i',
      }),
    ).rejects.toThrow(/no Stripe price for cadence 'yearly'/)
  })

  it('throws when neither per-call nor tenant config has successUrl/cancelUrl', async () => {
    const client = buildStripeClient({ productId: 'tax', secretKey: 'sk', webhookSecret: 'wh' })
    await expect(
      createCheckoutUrl(client, {
        workspaceId: 'w',
        plan: plans[0],
        billing: 'monthly',
        idempotencyKey: 'i',
      }),
    ).rejects.toThrow(/successUrl and cancelUrl required/)
  })

  it('passes customerId through when supplied', async () => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    await createCheckoutUrl(client, {
      workspaceId: 'w',
      plan: plans[0],
      billing: 'monthly',
      idempotencyKey: 'i',
      customerId: 'cus_42',
    })
    expect(new URLSearchParams(captured.body).get('customer')).toBe('cus_42')
  })
})

describe('createBillingPortalUrl', () => {
  it('POSTs /billing_portal/sessions and returns the hosted url', async () => {
    let capturedPath = ''
    const client = {
      productId: 'tax' as const,
      config: { productId: 'tax' as const, secretKey: 'sk', webhookSecret: 'wh' },
      async get<T>() {
        throw new Error()
        return null as T
      },
      async mutate<T>(_method: 'POST' | 'DELETE', path: string) {
        capturedPath = path
        return { id: 'bps_1', url: 'https://billing/bps_1' } as unknown as T
      },
    }
    const out = await createBillingPortalUrl(client, {
      customerId: 'cus_1',
      returnUrl: 'https://app',
      idempotencyKey: 'i',
    })
    expect(capturedPath).toBe('/billing_portal/sessions')
    expect(out).toEqual({ sessionId: 'bps_1', url: 'https://billing/bps_1' })
  })
})
