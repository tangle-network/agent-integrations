import { normalizeConversationEvent, type ConversationEventNormalizationResult, type ProviderConversationEvent } from './index.js'

export interface ConversationReply {
  /** Qualified existing Hub action. The host supplies the bound connection. */
  action: string
  input: Record<string, unknown>
  /** Pass as the invocation's idempotency key, unchanged on every retry of this reply. */
  idempotencyKey: string
}

export interface ConversationMediaReplyDescriptor {
  /** HTTPS location of one authorized media asset, using a DNS host rather than a direct IP. */
  url: string
}

type Failure = Exclude<ConversationEventNormalizationResult, { ok: true }>
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
const fail = (message: string): Failure => ({ ok: false, code: 'invalid_payload', message })
const validOperationId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 255 && /^[\x21-\x7e]+$/.test(value)
function validMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && host.includes('.') && !host.endsWith('.local')
      && !host.endsWith('.localhost') && !host.startsWith('[') && !/^\d+(?:\.\d+){3}$/.test(host)
      && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}
// Optional threading forwards only dot-atom IDs with DNS-style domains; other valid legacy forms are omitted.
const messageIdDotAtom = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const messageIdDomainLabel = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
function rfcMessageId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 256 || !value.startsWith('<') || !value.endsWith('>')) return null
  const parts = value.slice(1, -1).split('@')
  if (parts.length !== 2 || !messageIdDotAtom.test(parts[0]!)) return null
  const labels = parts[1]!.split('.')
  return labels.every((label) => label.length <= 63 && messageIdDomainLabel.test(label)) ? value : null
}

/**
 * Derive a plain-text reply from a previously authenticated, stored event.
 * No model-selected recipient, sender, fallback channel or credential.
 * This is routing, not permission: recheck the bound connection and current
 * grant, persist the outbox key/body, then invoke through the existing Hub SDK.
 */
export function buildMessagingReply(
  input: ProviderConversationEvent,
  text: string,
  operationId: string,
): { ok: true; reply: ConversationReply } | Failure {
  const normalized = normalizeConversationEvent(input)
  if (!normalized.ok) return normalized
  const event = normalized.event
  if (typeof text !== 'string' || !text.trim() || text.length > 10000 || text.includes('\0')) return fail('Reply text is empty or exceeds its limit')
  if (!validOperationId(operationId)) return fail('A stable operation id is required')
  if (event.historyOnly || event.isGroup) return fail('This event requires review or complete input before a reply')
  const data = object(object(input.payload).data)
  if (event.provider === 'inkbox') {
    if (event.eventType === 'inkbox.imessage.received') {
      return { ok: true, reply: { idempotencyKey: operationId, action: 'inkbox.imessage.reply', input: { conversation_id: event.conversationId, text } } }
    }
    if (event.eventType === 'inkbox.text.received') {
      const message = object(data.text_message)
      if (typeof message.phone_number_id !== 'string' || !message.phone_number_id || text.length > 1600) return fail('SMS requires its owned phone id and at most 1600 characters')
      return { ok: true, reply: { idempotencyKey: operationId, action: 'inkbox.sms.reply', input: { phone_number_id: message.phone_number_id, conversation_id: event.conversationId, text } } }
    }
    if (event.eventType === 'inkbox.message.received') {
      const message = object(data.message)
      if (!event.sender.address || typeof message.email_address !== 'string') return fail('Mail reply requires an explicit sender and mailbox')
      const subject = event.subject ?? ''
      const messageId = rfcMessageId(message.message_id)
      return { ok: true, reply: { idempotencyKey: operationId, action: 'inkbox.email.send', input: {
        email_address: message.email_address, to: [event.sender.address],
        subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`.slice(0, 998), text,
        ...(messageId ? { in_reply_to_message_id: messageId } : {}),
      } } }
    }
  }
  if (event.provider === 'linq-whatsapp') {
    if (text.length > 4096) return fail('WhatsApp text is limited to 4096 characters')
    return { ok: true, reply: { idempotencyKey: operationId, action: 'linq-whatsapp.messages.reply', input: { chat_id: event.conversationId, text } } }
  }
  if (event.provider === 'linq') {
    return { ok: true, reply: { idempotencyKey: operationId, action: 'linq.messages.reply', input: { chat_id: event.conversationId, text, message_key: operationId } } }
  }
  if (event.provider === 'resend') {
    const received = object(object(input.payload).received)
    if (!event.sender.address || !event.destinations[0]?.address) {
      return fail('Resend reply requires the authenticated mailbox and sender')
    }
    const subject = event.subject ?? 'Message'
    if (/[\u0000-\u001f\u007f]/.test(subject)) return fail('Email subject contains unsafe control characters')
    const parent = rfcMessageId(received.message_id)
    if (!parent) return fail('Resend reply requires a valid parent Message-ID')
    return { ok: true, reply: { idempotencyKey: operationId, action: 'resend.emails.reply', input: {
      from: event.destinations[0].address, to: [event.sender.address],
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`.slice(0, 998), text,
      message_key: operationId, in_reply_to: parent,
    } } }
  }
  if (event.provider === 'contiguity') {
    return { ok: true, reply: { idempotencyKey: operationId, action: event.eventType === 'contiguity.imessage.incoming' ? 'contiguity.messages.send_imessage' : 'contiguity.sms.send',
      input: { to: event.sender.address, from: event.destinations[0]?.address, message: text } } }
  }
  if (event.provider === 'sendblue') {
    if (!event.sender.address || !event.destinations[0]?.address) return fail('Sendblue reply requires the contact and owned line')
    return { ok: true, reply: { idempotencyKey: operationId, action: 'sendblue.messages.send',
      input: { from_number: event.destinations[0].address, number: event.sender.address, content: text } } }
  }
  if (event.provider === 'twilio-sms') {
    if (text.length > 1600 || !event.sender.address || !event.destinations[0]?.address) {
      return fail('Twilio SMS reply requires two phone numbers and at most 1600 characters')
    }
    return { ok: true, reply: { idempotencyKey: operationId, action: 'twilio-sms.send_sms',
      input: { from: event.destinations[0].address, to: event.sender.address, body: text } } }
  }
  return { ok: false, code: 'unsupported_provider', message: 'Use the existing channel-specific reply tool for this provider' }
}

/**
 * Plan one Linq media reply from a previously authenticated, stored inbound event.
 * The caller must authorize the media asset, bind the existing connection and grant,
 * and retain the same outbox key and body before every Hub invocation or retry.
 */
export function buildMessagingMediaReply(
  input: ProviderConversationEvent,
  media: ConversationMediaReplyDescriptor,
  operationId: string,
): { ok: true; reply: ConversationReply } | Failure {
  const normalized = normalizeConversationEvent(input)
  if (!normalized.ok) return normalized
  const event = normalized.event
  if (event.provider !== 'linq') {
    return { ok: false, code: 'unsupported_provider', message: 'Media replies require a Linq inbound event' }
  }
  if (event.eventType !== 'linq.message.received' || event.historyOnly || event.isGroup
    || !event.conversationId || event.conversationId.length > 256) {
    return fail('Media reply requires a current one-to-one Linq conversation')
  }
  if (!validOperationId(operationId)) return fail('A stable operation id is required')
  const descriptor = object(media)
  if (Object.keys(descriptor).length !== 1 || !validMediaUrl(descriptor.url)) {
    return fail('Media reply requires one HTTPS URL with a DNS host and no credentials or fragment')
  }
  return { ok: true, reply: {
    idempotencyKey: operationId,
    action: 'linq.messages.media.reply',
    input: { chat_id: event.conversationId, url: descriptor.url, message_key: operationId },
  } }
}
