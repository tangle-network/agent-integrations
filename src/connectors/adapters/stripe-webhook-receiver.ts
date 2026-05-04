/**
 * Stripe inbound-webhook receiver — push-only side of a Stripe connector.
 *
 * The full Stripe connector (charges/customers/invoices read+mutation) is
 * tracked in INTEGRATIONS.md as separate `stripe-customers` / `stripe-invoices`
 * rows. This adapter only ships the inbound surface today: receive a push,
 * verify the signature, persist one `InboundEvent` per Stripe event so the
 * agent's runtime can react (e.g. payment_failed → outbound dunning call).
 *
 * Why a dedicated `kind: 'stripe'` rather than reusing the billing webhook
 * at /api/billing/stripe-webhook: that route is hard-coded for OUR Stripe
 * account (Builder subscription state). This connector is for the customer's
 * OWN Stripe account — they paste their `whsec_*` and we listen on a
 * per-DataSource URL, /api/webhooks/inbound/stripe/:dataSourceId.
 *
 * Signature scheme: Stripe's `t=<unix>,v1=<hmac>` header. HMAC is
 * sha256(`${t}.${rawBody}`) keyed by the customer's webhook secret. We use
 * `timingSafeEqual` to defeat timing oracles and bound timestamp skew at
 * 5 minutes (Stripe's recommendation) to thwart replay against captured
 * signatures.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type EventHandlerResult,
  type InboundEvent,
} from '../types.js'

/** Stripe recommends 5-minute tolerance to defeat replay of captured signed
 *  bodies. The window is generous enough to absorb client clock drift but
 *  short enough that a stolen signature is useless minutes later. */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

/** Parse Stripe's `t=...,v1=...,v1=...` header. v1 may appear multiple times
 *  during a secret rotation — any one matching is sufficient. */
function parseStripeHeader(header: string): { t: number; sigs: string[] } | null {
  const t: { ts?: number; sigs: string[] } = { sigs: [] }
  for (const part of header.split(',')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim()
    if (key === 't') {
      const n = Number(val)
      if (Number.isFinite(n)) t.ts = n
    } else if (key === 'v1') {
      t.sigs.push(val)
    }
  }
  if (t.ts === undefined || t.sigs.length === 0) return null
  return { t: t.ts, sigs: t.sigs }
}

function verifyStripeSignature(rawBody: string, header: string, secret: string, now: number): boolean {
  const parsed = parseStripeHeader(header)
  if (!parsed) return false
  if (Math.abs(now - parsed.t) > SIGNATURE_TOLERANCE_SECONDS) return false
  const expected = createHmac('sha256', secret).update(`${parsed.t}.${rawBody}`).digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  for (const sig of parsed.sigs) {
    const sigBuf = Buffer.from(sig, 'utf8')
    if (sigBuf.length !== expectedBuf.length) continue
    if (timingSafeEqual(sigBuf, expectedBuf)) return true
  }
  return false
}

function firstHeader(h: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = h[name] ?? h[name.toLowerCase()]
  if (Array.isArray(v)) return v[0]
  return typeof v === 'string' ? v : undefined
}

export const stripeWebhookReceiverConnector: ConnectorAdapter = {
  manifest: {
    kind: 'stripe',
    displayName: 'Stripe (inbound events)',
    description:
      "Receive Stripe webhook events from your own Stripe account. Paste your endpoint signing secret (whsec_*) at connect time; we'll verify every push and feed events to your agent's runtime.",
    auth: { kind: 'hmac' },
    category: 'commerce',
    // Inbound-only today; outbound read/mutation are scaffolded. Stripe
    // events are advisory in this incarnation — the agent reacts to them
    // but doesn't compete for writes against the same resource.
    defaultConsistencyModel: 'advisory',
    capabilities: [],
  },

  async executeRead(_inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    throw new Error('not_implemented: stripe outbound read is scaffolded — use stripe-customers connector when shipped')
  },

  async executeMutation(_inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    throw new Error('not_implemented: stripe outbound mutation is scaffolded — use stripe-customers connector when shipped')
  },

  verifySignature({ rawBody, headers, source }) {
    if (source.credentials.kind !== 'hmac') return { valid: false, reason: 'missing_hmac_secret' }
    const sig = firstHeader(headers, 'stripe-signature')
    if (!sig) return { valid: false, reason: 'missing_stripe_signature_header' }
    const ok = verifyStripeSignature(rawBody, sig, source.credentials.secret, Math.floor(Date.now() / 1000))
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

// Exported for unit tests.
export const __test__ = { parseStripeHeader, verifyStripeSignature }
