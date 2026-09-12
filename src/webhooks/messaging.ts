import { createHmac, timingSafeEqual } from 'node:crypto'
import { verifyHmacSignature, verifyStripeSignature } from '../connectors/webhooks.js'
import type { WebhookEnvelope, WebhookHeaders, WebhookProvider } from './router.js'

/** A repeated authentication header is ambiguous, never an invitation to pick one. */
function header(headers: WebhookHeaders, name: string): string | null {
  const entries = Object.entries(headers).filter(([key]) => key.toLowerCase() === name)
  if (entries.length !== 1) return null
  const value = entries[0]?.[1]
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : null
}

function fresh(timestamp: string | null, now: number): timestamp is string {
  return timestamp !== null && /^\d{1,12}$/.test(timestamp)
    && Number.isSafeInteger(Number(timestamp))
    && Number.isFinite(now) && Math.abs(now - Number(timestamp)) <= 300
}

/** Inkbox signs the literal identity secret and request-id.timestamp.raw-body. */
export function verifyInkboxWebhook(rawBody: string, headers: WebhookHeaders, secret: string, now = Date.now() / 1000): boolean {
  const id = header(headers, 'x-inkbox-request-id')
  const timestamp = header(headers, 'x-inkbox-timestamp')
  const signature = header(headers, 'x-inkbox-signature')
  return Boolean(secret && id && signature && fresh(timestamp, now)
    && verifyHmacSignature(`${id}.${timestamp}.${rawBody}`, signature, secret, { signaturePrefix: 'sha256=' }))
}

/** Linq's Standard Webhooks scheme uses a base64-decoded signing key. */
export function verifyLinqWebhook(rawBody: string, headers: WebhookHeaders, secret: string, now = Date.now() / 1000): boolean {
  const id = header(headers, 'webhook-id')
  const timestamp = header(headers, 'webhook-timestamp')
  const signature = header(headers, 'webhook-signature')
  if (!id || !signature || !fresh(timestamp, now) || !secret.startsWith('whsec_')) return false
  const encoded = secret.slice(6)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false
  const key = Buffer.from(encoded, 'base64')
  if (key.length < 16 || key.toString('base64') !== encoded) return false
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64')
  return signature.split(' ').some((part) => part.startsWith('v1,')
    && part.slice(3).length === expected.length
    && timingSafeEqual(Buffer.from(part.slice(3)), Buffer.from(expected)))
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parse(provider: string, typeField: string, idField: string, input: Parameters<WebhookProvider['parse']>[0]): WebhookEnvelope[] {
  if (Buffer.byteLength(input.rawBody, 'utf8') > 1_048_576) throw new Error('Webhook exceeds 1 MiB')
  const value: unknown = JSON.parse(input.rawBody)
  if (!object(value) || typeof value[typeField] !== 'string' || typeof value[idField] !== 'string'
    || !/^[a-z][a-z0-9_.-]{0,100}$/.test(value[typeField] as string)
    || !(value[idField] as string).length || (value[idField] as string).length > 256) {
    throw new Error('Provider event requires a bounded event type and stable id')
  }
  // Credentials and signing headers do not belong in downstream transcripts.
  return [{ provider, eventType: `${provider}.${value[typeField]}`, providerEventId: value[idField] as string,
    receivedAt: input.now ?? Date.now(), payload: value, headers: {} }]
}

export const inkboxWebhookProvider: WebhookProvider = {
  id: 'inkbox',
  verifySignature: ({ rawBody, headers, secret }) => verifyInkboxWebhook(rawBody, headers, secret)
    ? { valid: true } : { valid: false, reason: 'invalid_signature' },
  parse: (input) => parse('inkbox', 'event_type', 'id', input),
  eventCatalog: { namespace: 'inkbox.', closed: false, events: [
    { id: 'inkbox.imessage.received' }, { id: 'inkbox.text.received' }, { id: 'inkbox.message.received' },
  ] },
}

export const linqWebhookProvider: WebhookProvider = {
  id: 'linq',
  verifySignature: ({ rawBody, headers, secret }) => verifyLinqWebhook(rawBody, headers, secret)
    ? { valid: true } : { valid: false, reason: 'invalid_signature' },
  parse: (input) => {
    const events = parse('linq', 'event_type', 'event_id', input)
    const id = header(input.headers, 'webhook-id')
    if (!id) throw new Error('Missing signed event identity')
    return events.map((event) => ({ ...event, providerEventId: id }))
  },
  eventCatalog: { namespace: 'linq.', closed: false, events: [{ id: 'linq.message.received' }] },
}

export const contiguityWebhookProvider: WebhookProvider = {
  id: 'contiguity',
  verifySignature: ({ rawBody, headers, secret }) => {
    const signature = header(headers, 'contiguity-signature')
    return secret && signature && verifyStripeSignature(rawBody, signature, secret)
      ? { valid: true } : { valid: false, reason: 'invalid_signature' }
  },
  parse: (input) => parse('contiguity', 'type', 'id', input),
  eventCatalog: { namespace: 'contiguity.', closed: false, events: [
    { id: 'contiguity.imessage.incoming' }, { id: 'contiguity.text.incoming.sms' },
    { id: 'contiguity.text.incoming.mms' },
  ] },
}
