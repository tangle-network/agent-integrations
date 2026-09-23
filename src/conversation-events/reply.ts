import { normalizeConversationEvent, type ConversationEventNormalizationResult, type ProviderConversationEvent } from './index.js'

export interface ConversationReply {
  /** Qualified existing Hub action. The host supplies the bound connection. */
  action: string
  input: Record<string, unknown>
  /** Pass as the invocation's idempotency key, unchanged on every retry of this reply. */
  idempotencyKey: string
}

type Failure = Exclude<ConversationEventNormalizationResult, { ok: true }>
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
const fail = (message: string): Failure => ({ ok: false, code: 'invalid_payload', message })
function rfcMessageId(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 256 && /^<[^<>\s@]+@[^<>\s@]+>$/.test(value) ? value : null
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
  if (typeof operationId !== 'string' || !operationId || operationId.length > 256 || /[\u0000-\u001f]/.test(operationId)) return fail('A stable operation id is required')
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
  if (event.provider === 'contiguity') {
    return { ok: true, reply: { idempotencyKey: operationId, action: event.eventType === 'contiguity.imessage.incoming' ? 'contiguity.messages.send_imessage' : 'contiguity.sms.send',
      input: { to: event.sender.address, from: event.destinations[0]?.address, message: text } } }
  }
  return { ok: false, code: 'unsupported_provider', message: 'Use the existing channel-specific reply tool for this provider' }
}
