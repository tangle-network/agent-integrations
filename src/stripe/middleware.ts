/**
 * Drop-in middleware for product agents.
 *
 * Three primitives consumers wire into their HTTP layer (Hono, Express,
 * raw Workers `fetch` handler — middleware here is framework-neutral,
 * returns a `BillingGate` value the consumer chooses how to respond to).
 *
 *   requireActiveSubscription({ workspaceId, store })
 *     → 'allow' | { allowed: false, error: BillingError }
 *
 *   withTrialAccess({ workspaceId, days, trialStore })
 *     → allow while trial < days expired since workspace creation
 *
 *   getRemainingFreeTier({ workspaceId, freeTierStore })
 *     → { remaining: number, total: number }
 *
 * Frameworks: we don't import Hono / Express. The middleware shape is a
 * pure async function returning a decision. The product wires it into
 * its framework with a 3-line adapter (see `examples/hono.ts`).
 *
 * Past-due policy: by default `requireActiveSubscription` allows
 * `past_due` (the dunning grace window — see `gateAccess` in
 * `subscription-state.ts`). Pass `denyPastDue: true` to override
 * per-route (e.g., legal-agent's "file new petition" gate where
 * irreversible actions justify a stricter rule).
 */

import { BillingError } from './errors.js'
import {
  gateAccess,
  type SubscriptionRecord,
  type SubscriptionStore,
} from './subscription-state.js'

/* ---------------------------------------------------------------------- */
/*                      requireActiveSubscription                          */
/* ---------------------------------------------------------------------- */

export interface RequireActiveSubscriptionInput {
  workspaceId: string
  store: SubscriptionStore
  /** Strict mode: reject `past_due`. Default false (allow with warn). */
  denyPastDue?: boolean
}

export type SubscriptionGateResult =
  | { allowed: true; record: SubscriptionRecord; warn?: 'past_due' | 'trial_ending' }
  | { allowed: false; error: BillingError }

/**
 * Gate decision for a route that requires an active subscription.
 *
 * Returns `{ allowed: true }` on `active` / `trialing` and on
 * `past_due` (unless `denyPastDue`). Returns `{ allowed: false, error }`
 * with a typed `BillingError` for any other state — the consumer maps
 * the error's `status` to the HTTP response.
 */
export async function requireActiveSubscription(
  input: RequireActiveSubscriptionInput,
): Promise<SubscriptionGateResult> {
  const record = await input.store.load(input.workspaceId)
  if (!record) {
    return {
      allowed: false,
      error: new BillingError({
        code: 'subscription_required',
        message: 'This workspace has no Stripe subscription.',
        context: { workspaceId: input.workspaceId },
      }),
    }
  }
  const decision = gateAccess(record.state)
  if (!decision.allowed) {
    return {
      allowed: false,
      error: new BillingError({
        code: decision.reason === 'subscription_inactive'
          ? 'subscription_inactive'
          : decision.reason === 'subscription_past_due'
          ? 'subscription_past_due'
          : 'subscription_required',
        message: `Subscription is ${record.state}.`,
        context: {
          workspaceId: input.workspaceId,
          subscriptionId: record.subscriptionId,
          subscriptionState: record.state,
        },
      }),
    }
  }
  if (decision.warn === 'past_due' && input.denyPastDue) {
    return {
      allowed: false,
      error: new BillingError({
        code: 'subscription_past_due',
        message: 'Subscription is past due — this action requires a current payment method.',
        context: {
          workspaceId: input.workspaceId,
          subscriptionId: record.subscriptionId,
          subscriptionState: record.state,
        },
      }),
    }
  }
  // Surface `trial_ending` warn when within 72h of trial end.
  let warn = decision.warn
  if (!warn && record.state === 'trialing' && record.trialEnd) {
    const TRIAL_WARN_SECONDS = 72 * 60 * 60
    const nowSec = Math.floor(Date.now() / 1000)
    if (record.trialEnd - nowSec < TRIAL_WARN_SECONDS) {
      warn = 'trial_ending'
    }
  }
  return { allowed: true, record, warn }
}

/* ---------------------------------------------------------------------- */
/*                          withTrialAccess                                */
/* ---------------------------------------------------------------------- */

/** Workspace creation timestamp store — required by `withTrialAccess`. */
export interface TrialStore {
  /** Returns workspace creation timestamp (ms epoch), or null if the
   *  workspace doesn't exist yet. */
  getCreatedAt(workspaceId: string): Promise<number | null> | number | null
}

export interface WithTrialAccessInput {
  workspaceId: string
  /** Trial length in days from workspace creation. */
  days: number
  trialStore: TrialStore
  /** Optional `now` override for tests. */
  now?: () => number
}

export interface TrialAccessResult {
  /** Whether the workspace is still inside its free-trial window. */
  inTrial: boolean
  /** Days remaining (rounded down). Zero when `inTrial` is false. */
  daysRemaining: number
  /** Trial end timestamp (ms epoch), null when no workspace found. */
  trialEndsAt: number | null
}

/**
 * Free-trial gate independent of Stripe state. Use BEFORE a workspace
 * has a Stripe subscription (the product's onboarding period). Compose
 * with `requireActiveSubscription`: trial OR active sub passes the gate.
 *
 * Composition pattern:
 *
 *   const trial = await withTrialAccess(...)
 *   if (trial.inTrial) return next()
 *   const sub = await requireActiveSubscription(...)
 *   if (sub.allowed) return next()
 *   return respond(sub.error)
 */
export async function withTrialAccess(input: WithTrialAccessInput): Promise<TrialAccessResult> {
  const createdAt = await input.trialStore.getCreatedAt(input.workspaceId)
  if (createdAt === null) {
    return { inTrial: false, daysRemaining: 0, trialEndsAt: null }
  }
  const now = (input.now ?? Date.now)()
  const trialEndsAt = createdAt + input.days * 24 * 60 * 60 * 1000
  const remainingMs = trialEndsAt - now
  if (remainingMs <= 0) {
    return { inTrial: false, daysRemaining: 0, trialEndsAt }
  }
  const daysRemaining = Math.floor(remainingMs / (24 * 60 * 60 * 1000))
  return { inTrial: true, daysRemaining, trialEndsAt }
}

/* ---------------------------------------------------------------------- */
/*                         getRemainingFreeTier                            */
/* ---------------------------------------------------------------------- */

/** Free-tier counter store — abstract over the consumer's metering
 *  pipeline. The interface is read-only; products own counter increment
 *  on usage (e.g., increment on every API call in their own metrics
 *  layer). */
export interface FreeTierStore {
  /** Returns `{ used, total }` for the workspace. Implementations
   *  return `{ used: 0, total: <default> }` for unknown workspaces if
   *  the product wants implicit free-tier grant. */
  getUsage(workspaceId: string): Promise<{ used: number; total: number }> | { used: number; total: number }
}

export interface GetRemainingFreeTierInput {
  workspaceId: string
  freeTierStore: FreeTierStore
}

export interface FreeTierResult {
  /** Units (whatever the product counts: API calls, tokens, generations) still allowed. */
  remaining: number
  /** Total quota. */
  total: number
  /** Whether the quota is exhausted. */
  exhausted: boolean
}

/**
 * Return how much free-tier quota the workspace has left. Pure projection
 * over the store; consumers use the result to decide whether to grant the
 * route or return `BillingError(code: 'free_tier_exhausted')`.
 *
 * Why this isn't a gate function itself: free-tier "exhausted" is rarely
 * a hard deny — most products throttle, queue, or upsell instead. The
 * decision is product-specific; we provide the read and the typed error
 * but stop short of opining on the response shape.
 */
export async function getRemainingFreeTier(
  input: GetRemainingFreeTierInput,
): Promise<FreeTierResult> {
  const { used, total } = await input.freeTierStore.getUsage(input.workspaceId)
  const remaining = Math.max(0, total - used)
  return { remaining, total, exhausted: remaining === 0 }
}

/* ---------------------------------------------------------------------- */
/*                       composed gate (trial + sub)                       */
/* ---------------------------------------------------------------------- */

export interface ComposedGateInput {
  workspaceId: string
  store: SubscriptionStore
  trialStore?: TrialStore
  trialDays?: number
  denyPastDue?: boolean
  now?: () => number
}

/**
 * Compose `withTrialAccess` || `requireActiveSubscription`. Most product
 * routes want this exact combo — passes if EITHER the workspace is
 * inside its free trial OR has an active subscription. Returns the
 * subscription error from `requireActiveSubscription` when both fail
 * (the more actionable of the two — the customer can convert it into
 * a checkout).
 */
export async function gateSubscriptionOrTrial(
  input: ComposedGateInput,
): Promise<SubscriptionGateResult & { viaTrial?: boolean; daysRemaining?: number }> {
  if (input.trialStore && input.trialDays) {
    const trial = await withTrialAccess({
      workspaceId: input.workspaceId,
      days: input.trialDays,
      trialStore: input.trialStore,
      now: input.now,
    })
    if (trial.inTrial) {
      // Synthesize a record-shaped result so the consumer's downstream
      // code path is uniform — but flag it as via-trial.
      const trialRecord = trialSyntheticRecord(input.workspaceId, trial.trialEndsAt ?? 0)
      return { allowed: true, record: trialRecord, viaTrial: true, daysRemaining: trial.daysRemaining }
    }
  }
  return requireActiveSubscription({
    workspaceId: input.workspaceId,
    store: input.store,
    denyPastDue: input.denyPastDue,
  })
}

function trialSyntheticRecord(workspaceId: string, trialEndsAt: number): SubscriptionRecord {
  return {
    workspaceId,
    customerId: '',
    subscriptionId: '',
    state: 'trialing',
    priceId: null,
    currentPeriodEnd: Math.floor(trialEndsAt / 1000),
    trialEnd: Math.floor(trialEndsAt / 1000),
    cancelAtPeriodEnd: false,
    version: 0,
    lastEventId: null,
    updatedAt: Date.now(),
  }
}
