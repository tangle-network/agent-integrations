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
          approvedPriceIds: ['price_pro_m', 'price_pro_y', 'price_starter_m'],
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
    expect(params.get('subscription_data[trial_period_days]')).toBeNull()
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

  it.each(['workspaceId', 'planId'])('rejects caller metadata that overrides %s', async (key) => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    await expect(createCheckoutUrl(client, {
      workspaceId: 'ws_2',
      plan: plans[0],
      billing: 'monthly',
      idempotencyKey: 'idem',
      metadata: { [key]: 'other-owner' },
    })).rejects.toThrow(/metadata key .* reserved/)
    expect(captured.body).toBeUndefined()
  })

  it('rejects a legacy plan trial before reaching Stripe', async () => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    await expect(
      createCheckoutUrl(client, {
        workspaceId: 'ws',
        plan: { ...plans[0], trialDays: 14 },
        billing: 'monthly',
        idempotencyKey: 'i',
      }),
    ).rejects.toThrow(/product-funded free trials are disabled/)
    expect(captured.body).toBeUndefined()
  })

  it('rejects a per-call trial before reaching Stripe', async () => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    await expect(
      createCheckoutUrl(client, {
        workspaceId: 'ws',
        plan: plans[0],
        billing: 'monthly',
        idempotencyKey: 'i',
        trialDays: 30,
      }),
    ).rejects.toThrow(/product-funded free trials are disabled/)
    expect(captured.body).toBeUndefined()
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
    const client = buildStripeClient({ productId: 'tax', secretKey: 'sk', webhookSecret: 'wh', approvedPriceIds: ['price_pro_m'] })
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

  it('rejects an unapproved Stripe price before reaching Stripe', async () => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    const unapproved = { ...plans[0], stripePriceIds: { monthly: 'price_unapproved' } }
    await expect(createCheckoutUrl(client, {
      workspaceId: 'w',
      plan: unapproved,
      billing: 'monthly',
      idempotencyKey: 'i',
    })).rejects.toThrow(/not approved/)
    expect(captured.body).toBeUndefined()
  })

  it.each([0, -1])('rejects a %s-dollar plan before reaching Stripe', async (amount) => {
    const captured: { body?: string } = {}
    const { client } = clientWithCapture(captured)
    const zeroPlan = { ...plans[0], monthlyUsd: amount }
    await expect(createCheckoutUrl(client, {
      workspaceId: 'w',
      plan: zeroPlan,
      billing: 'monthly',
      idempotencyKey: 'i',
    })).rejects.toThrow(/greater than zero/)
    expect(captured.body).toBeUndefined()
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
