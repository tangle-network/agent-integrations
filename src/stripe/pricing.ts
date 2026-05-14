/**
 * Pricing plan scaffold + checkout URL generator.
 *
 * Per task constraint, this module does NOT bake in pricing. The
 * consumer (product agent) supplies the `PricingPlan[]` table at boot.
 * We standardize the SHAPE (id, name, monthly/yearly USD, feature
 * bullets, stripe price ids), the LOOKUP (`findPlan`, `requirePlan`),
 * and the CHECKOUT URL flow (`createCheckoutUrl`).
 *
 * The shape is intentionally USD-only with month/year recurrence.
 * Stripe supports more — multi-currency, week/quarter, usage-based,
 * tiered — but adding columns we don't use creates pressure to fill
 * them with defaults that mislead. When a product needs more, extend
 * the shape; do not work around it in the consumer.
 *
 * `createCheckoutUrl` writes the workspaceId into
 * `subscription_data.metadata.workspaceId` so the dispatcher's default
 * `resolveWorkspaceId` finds it on the first `customer.subscription.created`
 * webhook. THIS IS LOAD-BEARING: drop it and you have to write a
 * customer → workspace join table by hand.
 */

import type { StripeClient } from './tenant-config.js'

export interface PricingPlanFeature {
  /** Short label rendered in pricing table rows. */
  label: string
  /** Optional richer description for the marketing page. */
  description?: string
  /** Whether the feature is included in this plan. Many products show
   *  the same feature row across plans with a check/cross. */
  included: boolean
}

export interface PricingPlan {
  /** Stable internal id — used by middleware to gate features, NOT the
   *  Stripe price id. */
  id: string
  /** Display name in the pricing table. */
  name: string
  /** Monthly price in whole USD. `null` for plans that are yearly-only
   *  or contact-sales tiers. */
  monthlyUsd: number | null
  /** Yearly price in whole USD. `null` for plans that don't offer
   *  annual billing. */
  yearlyUsd: number | null
  /** Marketing feature bullets. */
  features: PricingPlanFeature[]
  /** Stripe `price_…` ids per cadence. At least one must be set if the
   *  matching `*Usd` field is non-null. */
  stripePriceIds: {
    monthly?: string
    yearly?: string
  }
  /** Optional trial-day grant. The dispatcher writes `trialEnd` based
   *  on Stripe's response; this field is only the request-time intent. */
  trialDays?: number
  /** Optional metadata threaded into Stripe Subscription metadata — the
   *  product can use these for analytics or grant-feature lookup. */
  metadata?: Record<string, string>
}

export type BillingCadence = 'monthly' | 'yearly'

/** Find a plan by id. Returns null when not found. */
export function findPlan(plans: readonly PricingPlan[], id: string): PricingPlan | null {
  return plans.find((p) => p.id === id) ?? null
}

/** Look up a plan or throw — for code paths where missing is a bug
 *  (e.g., resolving a stored subscription's plan id back to a name). */
export function requirePlan(plans: readonly PricingPlan[], id: string): PricingPlan {
  const plan = findPlan(plans, id)
  if (!plan) throw new Error(`pricing: unknown plan id '${id}'`)
  return plan
}

export interface CreateCheckoutUrlInput {
  /** Tenant key — written to subscription metadata for webhook routing. */
  workspaceId: string
  /** Plan from the consumer's pricing table. */
  plan: PricingPlan
  /** Which Stripe price id to charge against. */
  billing: BillingCadence
  /** Optional existing Stripe customer id — pre-fills the checkout. */
  customerId?: string
  /** Customer email — used by Stripe to pre-fill or to create a new
   *  customer if `customerId` is absent. */
  customerEmail?: string
  /** Success/cancel URLs. Overrides the per-tenant defaults from
   *  `TenantStripeConfig.successUrl`/`cancelUrl`. */
  successUrl?: string
  cancelUrl?: string
  /** Idempotency key — pass a deterministic key (e.g.,
   *  `${workspaceId}:${plan.id}:${billing}`) so the same user clicking
   *  twice gets the same checkout session. */
  idempotencyKey: string
  /** Trial override — if set, beats `plan.trialDays`. */
  trialDays?: number
  /** Optional extra metadata mixed into Stripe metadata. */
  metadata?: Record<string, string>
}

export interface CheckoutUrl {
  sessionId: string
  url: string
}

/**
 * Create a Stripe checkout session and return its hosted URL. Uses the
 * per-tenant `StripeClient` from `getStripeClient(productId)`.
 *
 * The workspaceId is written into TWO metadata maps:
 *   - `metadata` (on the session itself, surfaces on `checkout.session.*`)
 *   - `subscription_data[metadata]` (carries through to the Subscription
 *     row Stripe creates, which is what `customer.subscription.*`
 *     webhooks carry)
 *
 * Without the second, the dispatcher can't route the first
 * `subscription.created` event to a workspace. We've shipped that bug
 * before — written here once to make it impossible to forget.
 */
export async function createCheckoutUrl(
  client: StripeClient,
  input: CreateCheckoutUrlInput,
): Promise<CheckoutUrl> {
  const priceId = input.plan.stripePriceIds[input.billing]
  if (!priceId) {
    throw new Error(`pricing: plan '${input.plan.id}' has no Stripe price for cadence '${input.billing}'`)
  }
  const successUrl = input.successUrl ?? client.config.successUrl
  const cancelUrl = input.cancelUrl ?? client.config.cancelUrl
  if (!successUrl || !cancelUrl) {
    throw new Error('pricing: successUrl and cancelUrl required (per-call or in TenantStripeConfig)')
  }

  const trialDays = input.trialDays ?? input.plan.trialDays
  const body: Record<string, string | number | boolean | undefined> = {
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    'metadata[workspaceId]': input.workspaceId,
    'metadata[planId]': input.plan.id,
    'subscription_data[metadata][workspaceId]': input.workspaceId,
    'subscription_data[metadata][planId]': input.plan.id,
  }
  if (input.customerId) body.customer = input.customerId
  if (input.customerEmail && !input.customerId) body.customer_email = input.customerEmail
  if (trialDays && trialDays > 0) {
    body['subscription_data[trial_period_days]'] = trialDays
  }
  // Mix in plan-defined metadata + caller-supplied metadata.
  const extra = { ...(input.plan.metadata ?? {}), ...(input.metadata ?? {}) }
  for (const [k, v] of Object.entries(extra)) {
    body[`metadata[${k}]`] = v
    body[`subscription_data[metadata][${k}]`] = v
  }

  const created = await client.mutate<{ id: string; url: string }>(
    'POST',
    '/checkout/sessions',
    body,
    input.idempotencyKey,
  )
  if (!created.url) {
    throw new Error('pricing: Stripe checkout response missing url')
  }
  return { sessionId: created.id, url: created.url }
}

/**
 * Create a Stripe customer-billing-portal session and return its URL.
 * The product calls this when a user clicks "manage billing" — the
 * portal handles cancel / change plan / update card without us
 * implementing those flows.
 */
export async function createBillingPortalUrl(
  client: StripeClient,
  input: { customerId: string; returnUrl: string; idempotencyKey: string },
): Promise<{ sessionId: string; url: string }> {
  const created = await client.mutate<{ id: string; url: string }>(
    'POST',
    '/billing_portal/sessions',
    {
      customer: input.customerId,
      return_url: input.returnUrl,
    },
    input.idempotencyKey,
  )
  return { sessionId: created.id, url: created.url }
}
