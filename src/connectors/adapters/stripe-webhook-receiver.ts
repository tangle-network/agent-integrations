/**
 * Stripe inbound-webhook receiver — push-only side of a Stripe connector.
 *
 * The full Stripe connector (charges/customers/invoices read+mutation) is
 * tracked in INTEGRATIONS.md as separate `stripe-customers` / `stripe-invoices`
 * rows. This adapter only ships the inbound surface today: receive a push,
 * verify the signature, persist one `InboundEvent` per Stripe event so the
 * agent's runtime can react (e.g. payment_failed → outbound dunning call).
 *
 * This connector is for the connected account owner: they paste their
 * `whsec_*` and the consuming product listens on a per-data-source URL such
 * as /api/webhooks/inbound/stripe/:dataSourceId.
 *
 * Signature scheme: Stripe's `t=<unix>,v1=<hmac>` header. HMAC is
 * sha256(`${t}.${rawBody}`) keyed by the customer's webhook secret. We use
 * `timingSafeEqual` to defeat timing oracles and bound timestamp skew at
 * 5 minutes (Stripe's recommendation) to thwart replay against captured
 * signatures.
 */

import {
  type ConnectorAdapter,
  type EventHandlerResult,
  type InboundEvent,
} from '../types.js'
import { firstHeader, verifyStripeSignature } from '../webhooks.js'

export const stripeWebhookReceiverConnector: ConnectorAdapter = {
  manifest: {
    kind: 'stripe',
    displayName: 'Stripe (inbound events)',
    description:
      "Receive Stripe webhook events from your own Stripe account. Paste your endpoint signing secret (whsec_*) at connect time; we'll verify every push and feed events to your agent's runtime.",
    auth: { kind: 'hmac' },
    category: 'commerce',
    // Inbound-only. Stripe events are advisory in this incarnation — the
    // agent reacts to them but doesn't compete for writes against the same
    // resource.
    defaultConsistencyModel: 'advisory',
    capabilities: [],
  },

  verifySignature({ rawBody, headers, source }) {
    if (source.credentials.kind !== 'hmac') return { valid: false, reason: 'missing_hmac_secret' }
    const sig = firstHeader(headers, 'stripe-signature')
    if (!sig) return { valid: false, reason: 'missing_stripe_signature_header' }
    const ok = verifyStripeSignature(rawBody, sig, source.credentials.secret)
    return ok ? { valid: true } : { valid: false, reason: 'invalid_signature' }
  },

  async handleInboundEvent({ rawBody }): Promise<EventHandlerResult> {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return { events: [], response: { status: 400, body: { error: 'invalid_json' } } }
    }
    if (!parsed || typeof parsed !== 'object') {
      return { events: [], response: { status: 400, body: { error: 'invalid_payload' } } }
    }
    const evt = parsed as { id?: unknown; type?: unknown; data?: unknown; created?: unknown }
    const eventType = typeof evt.type === 'string' ? evt.type : 'stripe.unknown'
    const providerEventId = typeof evt.id === 'string' ? evt.id : undefined
    const events: InboundEvent[] = [
      {
        eventType,
        providerEventId,
        payload: evt as Record<string, unknown>,
      },
    ]
    return { events }
  },

  async test(source) {
    if (source.credentials.kind !== 'hmac' || !source.credentials.secret) {
      return { ok: false, reason: 'webhook secret not configured' }
    }
    return { ok: true }
  },
}
