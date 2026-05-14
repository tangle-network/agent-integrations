/**
 * Stripe billing error taxonomy.
 *
 * Layered on top of `IntegrationRuntimeError` (the cross-package error
 * contract) so a billing failure surfaces through the same normalization
 * pipeline the rest of the integration runtime uses: `status` maps to
 * an HTTP status, `userAction` carries the recommended next step
 * (connect / reconnect / contact_support), and `code` is stable across
 * versions for product analytics.
 *
 * Why a billing-specific subclass and not bare `IntegrationRuntimeError`:
 * three error classes carry a payload product agents NEED to branch on
 * (subscription state, tenant id, plan id). Encoding them as discriminated
 * subclasses keeps the call site `instanceof BillingError` lookup O(1)
 * and avoids stuffing them into `metadata` where they decay to `unknown`.
 *
 * Code mapping (`BillingErrorCode` → `IntegrationErrorCode`):
 *   subscription_required → action_denied        (403)
 *   subscription_inactive → action_denied        (403)
 *   subscription_past_due → action_denied        (403, w/ warning)
 *   trial_expired         → action_denied        (403)
 *   free_tier_exhausted   → action_denied        (403)
 *   tenant_not_configured → provider_error       (500) — operator bug
 *   webhook_secret_missing→ provider_auth_failed (401) — config bug
 *   webhook_event_unknown → input_invalid        (400)
 *   webhook_replay        → input_invalid        (400)
 */

import { IntegrationRuntimeError, type IntegrationUserAction } from '../errors.js'
import type { SubscriptionState } from './subscription-state.js'

export type BillingErrorCode =
  | 'subscription_required'
  | 'subscription_inactive'
  | 'subscription_past_due'
  | 'trial_expired'
  | 'free_tier_exhausted'
  | 'tenant_not_configured'
  | 'webhook_secret_missing'
  | 'webhook_event_unknown'
  | 'webhook_replay'

export interface BillingErrorContext {
  workspaceId?: string
  productId?: string
  subscriptionId?: string
  subscriptionState?: SubscriptionState
  planId?: string
  eventId?: string
}

export class BillingError extends IntegrationRuntimeError {
  readonly billingCode: BillingErrorCode
  readonly context: BillingErrorContext

  constructor(input: {
    code: BillingErrorCode
    message: string
    context?: BillingErrorContext
    userAction?: IntegrationUserAction
  }) {
    super({
      code: mapToIntegrationCode(input.code),
      message: input.message,
      status: statusForBillingCode(input.code),
      userAction: input.userAction ?? defaultUserAction(input.code),
      metadata: input.context as Record<string, unknown> | undefined,
    })
    this.name = 'BillingError'
    this.billingCode = input.code
    this.context = input.context ?? {}
  }
}

/** Distinct subclass: operator missed an environment variable. Surfaces
 *  with a different `userAction` (`contact_support`) so the consumer
 *  doesn't render a "connect Stripe" CTA to a customer for what is in
 *  fact a backend deploy bug. */
export class ConfigError extends BillingError {
  constructor(input: { message: string; context?: BillingErrorContext }) {
    super({
      code: 'tenant_not_configured',
      message: input.message,
      context: input.context,
      userAction: { type: 'contact_support', label: 'Contact support' },
    })
    this.name = 'ConfigError'
  }
}

function mapToIntegrationCode(code: BillingErrorCode): IntegrationRuntimeError['code'] {
  switch (code) {
    case 'subscription_required':
    case 'subscription_inactive':
    case 'subscription_past_due':
    case 'trial_expired':
    case 'free_tier_exhausted':
      return 'action_denied'
    case 'tenant_not_configured':
      return 'provider_error'
    case 'webhook_secret_missing':
      return 'provider_auth_failed'
    case 'webhook_event_unknown':
    case 'webhook_replay':
      return 'input_invalid'
  }
}

function statusForBillingCode(code: BillingErrorCode): number {
  switch (code) {
    case 'subscription_required':
    case 'subscription_inactive':
    case 'subscription_past_due':
    case 'trial_expired':
    case 'free_tier_exhausted':
      return 403
    case 'tenant_not_configured':
      return 500
    case 'webhook_secret_missing':
      return 401
    case 'webhook_event_unknown':
    case 'webhook_replay':
      return 400
  }
}

function defaultUserAction(code: BillingErrorCode): IntegrationUserAction | undefined {
  switch (code) {
    case 'subscription_required':
      return { type: 'change_request', label: 'Subscribe to continue' }
    case 'subscription_inactive':
    case 'subscription_past_due':
      return { type: 'change_request', label: 'Update billing' }
    case 'trial_expired':
      return { type: 'change_request', label: 'Choose a plan' }
    case 'free_tier_exhausted':
      return { type: 'change_request', label: 'Upgrade for more usage' }
    case 'tenant_not_configured':
    case 'webhook_secret_missing':
      return { type: 'contact_support', label: 'Contact support' }
    case 'webhook_event_unknown':
    case 'webhook_replay':
      return undefined
  }
}
