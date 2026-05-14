/**
 * Pre-built `WebhookProvider` implementations for the inbound surfaces
 * the substrate ships first-party verifiers for.
 *
 * Each provider implementation is intentionally thin: it delegates
 * signature verification to the corresponding pure function in
 * `connectors/webhooks.ts` and parses the body into one or more
 * normalized `WebhookEnvelope` rows. Anything provider-specific that
 * doesn't fit cleanly (Slack URL-verification handshake, etc.) is
 * surfaced via the envelope `eventType` so the consumer's `deliver()`
 * can branch.
 */

import {
  firstHeader,
  verifyHmacSignature,
  verifySlackSignature,
  verifyStripeSignature,
} from '../connectors/webhooks.js'
import type { WebhookEnvelope, WebhookHeaders, WebhookProvider, SignatureVerification } from './router.js'
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Stripe webhook provider. Signature header `Stripe-Signature`. */
export const stripeWebhookProvider: WebhookProvider = {
  id: 'stripe',
  verifySignature({ rawBody, headers, secret }): SignatureVerification {
    const sig = firstHeader(headers, 'stripe-signature')
    if (!sig) return { valid: false, reason: 'missing_stripe_signature' }
    return verifyStripeSignature(rawBody, sig, secret)
      ? { valid: true }
      : { valid: false, reason: 'invalid_signature' }
  },
  parse({ rawBody, headers, now }): WebhookEnvelope[] {
    const evt = safeJson(rawBody)
    if (!evt || typeof evt !== 'object') return []
    const e = evt as { id?: unknown; type?: unknown }
    return [
      {
        provider: 'stripe',
        eventType: typeof e.type === 'string' ? e.type : 'stripe.unknown',
        providerEventId: typeof e.id === 'string' ? e.id : undefined,
        receivedAt: now ?? Date.now(),
        payload: evt,
        headers: normalizeHeaders(headers),
      },
    ]
  },
}

/** Slack Events API provider. Handles the `url_verification` handshake
 *  by emitting a synthetic event the consumer's `deliver()` can echo. */
export const slackWebhookProvider: WebhookProvider = {
  id: 'slack',
  verifySignature({ rawBody, headers, secret }): SignatureVerification {
    const sig = firstHeader(headers, 'x-slack-signature')
    const ts = firstHeader(headers, 'x-slack-request-timestamp')
    if (!sig || !ts) return { valid: false, reason: 'missing_slack_signature_or_timestamp' }
    return verifySlackSignature(rawBody, sig, ts, secret)
      ? { valid: true }
      : { valid: false, reason: 'invalid_signature' }
  },
  parse({ rawBody, headers, now }): WebhookEnvelope[] {
    const evt = safeJson(rawBody) as { type?: string; event_id?: string; event?: { type?: string } } | null
    if (!evt || typeof evt !== 'object') return []
    if (evt.type === 'url_verification') {
      return [{
        provider: 'slack',
        eventType: 'slack.url_verification',
        receivedAt: now ?? Date.now(),
        payload: evt,
        headers: normalizeHeaders(headers),
      }]
    }
    const eventType = `slack.${evt.event?.type ?? evt.type ?? 'unknown'}`
    return [{
      provider: 'slack',
      eventType,
      providerEventId: typeof evt.event_id === 'string' ? evt.event_id : undefined,
      receivedAt: now ?? Date.now(),
      payload: evt,
      headers: normalizeHeaders(headers),
    }]
  },
}

/** DocuSeal webhook provider. Signature header `X-Docuseal-Signature`. */
export const docusealWebhookProvider: WebhookProvider = {
  id: 'docuseal',
  verifySignature({ rawBody, headers, secret }): SignatureVerification {
    const sig = firstHeader(headers, 'x-docuseal-signature')
    if (!sig) return { valid: false, reason: 'missing_docuseal_signature' }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(sig.toLowerCase(), 'utf-8')
    const b = Buffer.from(expected, 'utf-8')
    if (a.length !== b.length) return { valid: false, reason: 'invalid_signature' }
    return timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'invalid_signature' }
  },
  parse({ rawBody, headers, now }): WebhookEnvelope[] {
    const evt = safeJson(rawBody) as { event_type?: string; event_id?: string } | null
    if (!evt || typeof evt !== 'object') return []
    return [{
      provider: 'docuseal',
      eventType: `docuseal.${evt.event_type ?? 'unknown'}`,
      providerEventId: typeof evt.event_id === 'string' ? evt.event_id : undefined,
      receivedAt: now ?? Date.now(),
      payload: evt,
      headers: normalizeHeaders(headers),
    }]
  },
}

/** Gmail push provider. Cloud Pub/Sub posts a JWT-signed envelope; the
 *  *payload* is base64 JSON describing the changed history range. The
 *  signature scheme here is the Pub/Sub JWT auth header — when supplied,
 *  consumers SHOULD verify the JWT against Google's well-known
 *  certificates. We accept the simpler "Bearer <pubsub-shared-secret>"
 *  variant by default (matching `verifyHmacSignature`). */
export const gmailWebhookProvider: WebhookProvider = {
  id: 'gmail',
  verifySignature({ headers, secret }): SignatureVerification {
    const auth = firstHeader(headers, 'authorization')
    if (!auth) return { valid: false, reason: 'missing_authorization' }
    // Accept either "Bearer <secret>" or "Token <secret>" formats. This
    // is the simple per-tenant shared-secret path; JWT verification is
    // left to the consumer's `deliver()` when they need full Google JWT
    // chain validation.
    const m = /^(?:Bearer|Token)\s+(.+)$/i.exec(auth)
    if (!m) return { valid: false, reason: 'invalid_authorization_format' }
    const a = Buffer.from(m[1]!, 'utf-8')
    const b = Buffer.from(secret, 'utf-8')
    if (a.length !== b.length) return { valid: false, reason: 'invalid_signature' }
    return timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'invalid_signature' }
  },
  parse({ rawBody, headers, now }): WebhookEnvelope[] {
    const envelope = safeJson(rawBody) as { message?: { data?: string; messageId?: string; publishTime?: string } } | null
    if (!envelope?.message?.data) return []
    let payload: unknown
    try {
      payload = JSON.parse(Buffer.from(envelope.message.data, 'base64').toString('utf-8'))
    } catch {
      return []
    }
    const inner = payload as { historyId?: number | string; emailAddress?: string }
    return [{
      provider: 'gmail',
      eventType: 'gmail.history_changed',
      providerEventId: envelope.message.messageId,
      receivedAt: now ?? Date.now(),
      payload: { ...inner, publishTime: envelope.message.publishTime },
      headers: normalizeHeaders(headers),
    }]
  },
}

/** Google Drive push provider. Drive does NOT sign the body — it uses
 *  the per-channel token (`X-Goog-Channel-Token`) as the shared secret.
 *  The router compares it constant-time against the resolved secret. */
export const gdriveWebhookProvider: WebhookProvider = {
  id: 'gdrive',
  verifySignature({ headers, secret }): SignatureVerification {
    const token = firstHeader(headers, 'x-goog-channel-token')
    if (!token) return { valid: false, reason: 'missing_channel_token' }
    const a = Buffer.from(token, 'utf-8')
    const b = Buffer.from(secret, 'utf-8')
    if (a.length !== b.length) return { valid: false, reason: 'invalid_signature' }
    return timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'invalid_signature' }
  },
  parse({ headers, now }): WebhookEnvelope[] {
    const resourceId = firstHeader(headers, 'x-goog-resource-id')
    const resourceState = firstHeader(headers, 'x-goog-resource-state') ?? 'unknown'
    const channelId = firstHeader(headers, 'x-goog-channel-id')
    const messageNumber = firstHeader(headers, 'x-goog-message-number')
    if (resourceState === 'sync') {
      return [{
        provider: 'gdrive',
        eventType: 'gdrive.channel.sync',
        providerEventId: messageNumber ? `${channelId}-${messageNumber}` : undefined,
        receivedAt: now ?? Date.now(),
        payload: { channelId, resourceId, resourceState },
        headers: normalizeHeaders(headers),
      }]
    }
    return [{
      provider: 'gdrive',
      eventType: `gdrive.resource.${resourceState}`,
      providerEventId: messageNumber ? `${channelId}-${messageNumber}` : undefined,
      receivedAt: now ?? Date.now(),
      payload: { channelId, resourceId, resourceState },
      headers: normalizeHeaders(headers),
    }]
  },
}

/** Generic HMAC provider — for the long-tail webhook source where the
 *  caller has standardised on a single sha256-of-body scheme. Header
 *  `X-Signature` by default; override at provider-build time if needed. */
export function genericHmacWebhookProvider(options: {
  id: string
  signatureHeader?: string
  algorithm?: 'sha256' | 'sha1' | 'sha512'
  signaturePrefix?: string
  /** Parser to convert the raw body into envelopes. Defaults to
   *  "one event with eventType=<provider>.event and payload=JSON". */
  parse?: WebhookProvider['parse']
}): WebhookProvider {
  const header = options.signatureHeader ?? 'x-signature'
  return {
    id: options.id,
    verifySignature({ rawBody, headers, secret }) {
      const sig = firstHeader(headers, header)
      if (!sig) return { valid: false, reason: `missing_${header}` }
      return verifyHmacSignature(rawBody, sig, secret, {
        algorithm: options.algorithm ?? 'sha256',
        signaturePrefix: options.signaturePrefix,
      })
        ? { valid: true }
        : { valid: false, reason: 'invalid_signature' }
    },
    parse:
      options.parse ??
      (({ rawBody, headers, now }) => {
        const evt = safeJson(rawBody) ?? rawBody
        return [{
          provider: options.id,
          eventType: `${options.id}.event`,
          receivedAt: now ?? Date.now(),
          payload: evt,
          headers: normalizeHeaders(headers),
        }]
      }),
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function normalizeHeaders(headers: WebhookHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue
    const value = Array.isArray(v) ? v[0] : v
    if (typeof value === 'string') out[k.toLowerCase()] = value
  }
  return out
}
