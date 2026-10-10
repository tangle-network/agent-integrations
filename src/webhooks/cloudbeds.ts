/**
 * Cloudbeds PMS webhook provider.
 *
 * Cloudbeds does not sign webhook bodies. `postWebhook` accepts an
 * `authHeaderName`/`authHeaderValue` pair, sends that header on every delivery,
 * never returns the value from `getWebhooks`, and rotates it on re-post
 * (pms-v1.3 PostWebhookRequest). Subscribe with `authHeaderName` set to
 * `CLOUDBEDS_WEBHOOK_AUTH_HEADER` and a per-connection secret as the value; the
 * verifier compares that header with the secret in constant time.
 *
 * The header proves the delivery came from a subscription holding the secret,
 * but it does not bind the body. Every envelope is a hint: consumers re-read the
 * reservation through `reservations.get` before acting on it.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { CLOUDBEDS_WEBHOOK_EVENTS } from '../connectors/adapters/cloudbeds.js'
import { firstHeader } from '../connectors/webhooks.js'
import type { SignatureVerification, WebhookEnvelope, WebhookHeaders, WebhookProvider } from './router.js'

/** Header name to pass as `authHeaderName` to `webhooks.subscribe`. */
export const CLOUDBEDS_WEBHOOK_AUTH_HEADER = 'x-tangle-webhook-token'

const EVENTS = new Set<string>(CLOUDBEDS_WEBHOOK_EVENTS.map(({ object, action }) => `${object}/${action}`))
const NUMERIC_ID = /^[1-9]\d{0,19}$/
const RESERVATION_ID = /^[A-Za-z0-9_-]{1,64}$/

function idText(value: unknown, pattern: RegExp): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  return typeof text === 'string' && pattern.test(text) ? text : null
}

function headersOf(headers: WebhookHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || key.toLowerCase() === CLOUDBEDS_WEBHOOK_AUTH_HEADER) continue
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

export const cloudbedsWebhookProvider: WebhookProvider = {
  id: 'cloudbeds',
  verifySignature({ headers, secret }): SignatureVerification {
    const token = firstHeader(headers, CLOUDBEDS_WEBHOOK_AUTH_HEADER)
    if (!token) return { valid: false, reason: 'missing_cloudbeds_webhook_token' }
    if (!secret) return { valid: false, reason: 'missing_secret' }
    const actual = Buffer.from(token, 'utf-8')
    const expected = Buffer.from(secret, 'utf-8')
    if (actual.length !== expected.length) return { valid: false, reason: 'invalid_webhook_token' }
    return timingSafeEqual(actual, expected) ? { valid: true } : { valid: false, reason: 'invalid_webhook_token' }
  },
  parse({ rawBody, headers, now }): WebhookEnvelope[] {
    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      throw new Error('cloudbeds webhook body is not JSON')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('cloudbeds webhook body is not an object')
    const evt = body as Record<string, unknown>
    // Unsubscribed events are acknowledged as no-ops so Cloudbeds stops retrying.
    if (typeof evt.event !== 'string' || !EVENTS.has(evt.event)) return []
    // The Cloudbeds guide warns that ID spelling varies by event.
    const propertyId = idText(evt.propertyID, NUMERIC_ID) ?? idText(evt.propertyID_str, NUMERIC_ID) ??
      idText(evt.propertyId, NUMERIC_ID) ?? idText(evt.propertyId_str, NUMERIC_ID)
    const reservationId = idText(evt.reservationID, RESERVATION_ID) ?? idText(evt.reservationId, RESERVATION_ID)
    if (!propertyId || !reservationId) throw new Error('cloudbeds webhook is missing propertyId or reservationId')
    const timestamp = typeof evt.timestamp === 'number' || typeof evt.timestamp === 'string' ? String(evt.timestamp) : ''
    const [object, action] = evt.event.split('/')
    return [{
      provider: 'cloudbeds',
      eventType: `cloudbeds.${object}.${action}`,
      // Cloudbeds keeps the original timestamp across its five retries.
      providerEventId: createHash('sha256').update(`${evt.event}|${propertyId}|${reservationId}|${timestamp}`).digest('hex'),
      receivedAt: now ?? Date.now(),
      payload: { ...evt, propertyId, reservationId },
      headers: headersOf(headers),
    }]
  },
  eventCatalog: {
    // Derived from the same allowlist `webhooks.subscribe` accepts and `parse` emits.
    namespace: 'cloudbeds.',
    closed: true,
    events: CLOUDBEDS_WEBHOOK_EVENTS.map(({ object, action }) => ({ id: `cloudbeds.${object}.${action}` })),
  },
}
