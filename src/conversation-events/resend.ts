import type { ConversationEvent, ConversationEventNormalizationResult, ProviderConversationEvent } from './index.js'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function address(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 320) return null
  const match = /^(?:[^<>]*<)?([^<>\s]+@[^<>\s]+)(?:>)?$/.exec(value.trim())
  return match?.[1]?.toLowerCase() ?? null
}
const invalid = (message: string): ConversationEventNormalizationResult => ({ ok: false, code: 'invalid_payload', message })

/** The host adds the provider-read email after verifying the notification. */
export function normalizeResendConversation(input: ProviderConversationEvent): ConversationEventNormalizationResult {
  const payload = input.payload
  if (input.type !== 'resend.email.received' || !record(payload) || payload.type !== 'email.received'
    || !record(payload.data) || !record(payload.received)) return invalid('Resend requires a hydrated received-email notification')
  const data = payload.data, received = payload.received
  if (typeof data.email_id !== 'string' || received.id !== data.email_id
    || !Array.isArray(received.to) || received.to.length !== 1
    || !address(received.from) || !address(received.to[0])
    || (received.text != null && typeof received.text !== 'string')
    || typeof received.created_at !== 'string' || !Number.isFinite(Date.parse(received.created_at))) {
    return invalid('Resend email identity, sender, recipient, body or time is invalid')
  }
  const attachments = Array.isArray(received.attachments) ? received.attachments : []
  if (attachments.length > 50 || attachments.some(item => !record(item) || typeof item.id !== 'string')) {
    return invalid('Resend attachments require provider ids')
  }
  const sender = address(received.from)!, destination = address(received.to[0])!
  const event: ConversationEvent = {
    version: 1, provider: 'resend', eventType: input.type, operation: 'created',
    eventId: data.email_id, conversationId: data.email_id, parentEventIds: [],
    sender: { id: sender, address: sender, displayName: null, verificationStatus: 'unverified' },
    destinations: [{ kind: 'mailbox', id: destination, address: destination, displayName: null }],
    subject: typeof received.subject === 'string' ? received.subject.slice(0, 998) : null,
    text: typeof received.text === 'string' ? received.text : null,
    html: null,
    attachments: attachments.map(item => {
      const value = item as Record<string, unknown>
      return { id: value.id as string, name: typeof value.filename === 'string' ? value.filename : null,
        contentType: typeof value.content_type === 'string' ? value.content_type : null,
        size: null, contentBase64: null, url: null }
    }),
    occurredAt: Date.parse(received.created_at), transport: 'email',
    historyOnly: typeof received.text !== 'string',
  }
  return { ok: true, event }
}
