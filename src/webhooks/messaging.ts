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

/** Standard Webhooks signs the exact request bytes and three bounded headers. */
function verifyStandardWebhook(rawBody: string, headers: WebhookHeaders, secret: string, prefix: 'webhook' | 'svix', now: number): boolean {
  const id = header(headers, `${prefix}-id`)
  const timestamp = header(headers, `${prefix}-timestamp`)
  const signature = header(headers, `${prefix}-signature`)
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

/** Both Linq services use Standard Webhooks with a base64-decoded signing key. */
export function verifyLinqWebhook(rawBody: string, headers: WebhookHeaders, secret: string, now = Date.now() / 1000): boolean {
  return verifyStandardWebhook(rawBody, headers, secret, 'webhook', now)
}

/** Resend uses the Svix header names for the same signed-body protocol. */
export function verifyResendWebhook(rawBody: string, headers: WebhookHeaders, secret: string, now = Date.now() / 1000): boolean {
  return verifyStandardWebhook(rawBody, headers, secret, 'svix', now)
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

export const linqWhatsappWebhookProvider: WebhookProvider = {
  id: 'linq-whatsapp',
  verifySignature: ({ rawBody, headers, secret }) => verifyLinqWebhook(rawBody, headers, secret)
    ? { valid: true } : { valid: false, reason: 'invalid_signature' },
  parse: (input) => {
    const events = parse('linq-whatsapp', 'type', 'id', input)
    if (events[0]?.providerEventId !== header(input.headers, 'webhook-id')) throw new Error('Signed event identity mismatch')
    return events
  },
  eventCatalog: { namespace: 'linq-whatsapp.', closed: false, events: [{ id: 'linq-whatsapp.message.received' }] },
}

export const resendWebhookProvider: WebhookProvider = {
  id: 'resend',
  verifySignature: ({ rawBody, headers, secret }) => verifyResendWebhook(rawBody, headers, secret)
    ? { valid: true } : { valid: false, reason: 'invalid_signature' },
  parse: (input) => {
    if (Buffer.byteLength(input.rawBody, 'utf8') > 1_048_576) throw new Error('Webhook exceeds 1 MiB')
    const value: unknown = JSON.parse(input.rawBody)
    if (!object(value) || value.type !== 'email.received' || !object(value.data)
      || typeof value.data.email_id !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.data.email_id)) {
      throw new Error('Resend event requires a received email id')
    }
    const signedId = header(input.headers, 'svix-id')
    if (!signedId) throw new Error('Missing signed event identity')
    return [{ provider: 'resend', eventType: 'resend.email.received', providerEventId: signedId,
      receivedAt: input.now ?? Date.now(), payload: value, headers: {} }]
  },
  eventCatalog: { namespace: 'resend.', closed: true, events: [{ id: 'resend.email.received' }] },
}

/** Sendblue sends a shared secret verbatim, with no signed timestamp. Deduplicate by message_handle. */
export const sendblueWebhookProvider: WebhookProvider = {
  id: 'sendblue',
  verifySignature: ({ headers, secret }) => {
    const supplied = header(headers, 'sb-signing-secret')
    if (!secret || !supplied) return { valid: false, reason: 'invalid_signature' }
    const actual = Buffer.from(supplied), expected = Buffer.from(secret)
    if (actual.length !== expected.length) return { valid: false, reason: 'invalid_signature' }
    return timingSafeEqual(actual, expected)
      ? { valid: true } : { valid: false, reason: 'invalid_signature' }
  },
  parse: (input) => {
    if (Buffer.byteLength(input.rawBody, 'utf8') > 1_048_576) throw new Error('Webhook exceeds 1 MiB')
    const value: unknown = JSON.parse(input.rawBody)
    if (!object(value) || typeof value.message_handle !== 'string' || !value.message_handle
      || value.message_handle.length > 256 || typeof value.is_outbound !== 'boolean') {
      throw new Error('Sendblue event requires a stable message handle and direction')
    }
    if (value.is_outbound) return []
    if (value.message_type !== 'message' && value.message_type !== 'group') {
      throw new Error('Unsupported Sendblue inbound message type')
    }
    return [{ provider: 'sendblue', eventType: 'sendblue.message.received',
      providerEventId: value.message_handle, receivedAt: input.now ?? Date.now(), payload: value, headers: {} }]
  },
  eventCatalog: { namespace: 'sendblue.', closed: true, events: [{ id: 'sendblue.message.received' }] },
}
