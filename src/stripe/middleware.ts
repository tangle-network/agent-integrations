/**
 * Drop-in middleware for product agents.
 *
 * One primitive consumers wire into their HTTP layer (Hono, Express,
 * raw Workers `fetch` handler — middleware here is framework-neutral,
 * returns a `BillingGate` value the consumer chooses how to respond to):
 *
 *   requireActiveSubscription({ workspaceId, store })
 *     → 'allow' | { allowed: false, error: BillingError }
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
import { decideBillingAccess } from '../billing-access-policy.js'
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
  /** Parsed Platform proof for the owner or an explicitly named service/admin. */
  accessEvidence?: import('../billing-access-policy.js').TrustedPlatformEvidence
  /** Optional owner id to compare with Platform proof. */
  expectedUserId?: string
  /** Strict mode: reject `past_due`. Default false (allow with warn). */
  denyPastDue?: boolean
}

export type SubscriptionGateResult =
  | { allowed: true; record: SubscriptionRecord; warn?: 'past_due' | 'trial_ending' }
  | { allowed: false; error: BillingError }

/**
 * Gate decision for a route that requires an active subscription.
 *
 * Returns `{ allowed: true }` on `active` and on `past_due` (unless
 * `denyPastDue`). A `trialing` record is denied because product-funded
 * trials are disabled. Returns `{ allowed: false, error }` with a typed
 * `BillingError` for any other state.
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
  const accessDecision = decideBillingAccess({
    evidence: input.accessEvidence,
    expectedUserId: input.expectedUserId,
  })
  if (!accessDecision.allowed) {
    return {
      allowed: false,
      error: new BillingError({
        code: accessDecision.code,
        message: accessDecision.reason,
        context: { workspaceId: input.workspaceId },
      }),
    }
  }
  if (
    accessDecision.basis !== 'paid_subscription' &&
    accessDecision.principal.kind === 'human'
  ) {
    return {
      allowed: false,
      error: new BillingError({
        code: 'paid_evidence_required',
        message: 'Active subscription access requires matching paid subscription evidence.',
        context: { workspaceId: input.workspaceId },
      }),
    }
  }
  if (
    input.accessEvidence?.funding.kind === 'paid_subscription' &&
    input.accessEvidence.funding.subscriptionId !== record.subscriptionId
  ) {
    return {
      allowed: false,
      error: new BillingError({
        code: 'platform_evidence_subject_mismatch',
        message: 'Subscription evidence does not match the stored subscription.',
        context: { workspaceId: input.workspaceId, subscriptionId: record.subscriptionId },
      }),
    }
  }
  const decision = gateAccess(record.state)
  if (!decision.allowed) {
    return {
      allowed: false,
      error: new BillingError({
        code: decision.reason === 'trial_expired'
          ? 'trial_expired'
          : decision.reason === 'subscription_inactive'
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
  return { allowed: true, record, warn: decision.warn }
}

