import type { ConversationEventNormalizationResult, ProviderConversationEvent } from './index.js'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
}
const invalid = (message: string): ConversationEventNormalizationResult => ({ ok: false, code: 'invalid_payload', message })

/** Fresh webhook snapshots only. Historical range notifications need journal hydration.
 * A chat represents one customer, but the message does not contain their address.
 * Keep that customer opaque; never mislabel message.from (our number) as the sender. */
export function normalizeLinqWhatsappConversation(input: ProviderConversationEvent): ConversationEventNormalizationResult {
  const value = input.payload
  if (!object(value) || input.type !== `linq-whatsapp.${value.type}`) return invalid('Event type does not match the provider envelope')
  if (value.type !== 'message.received') return { ok: false, code: 'unsupported_event', message: 'Not an incoming message' }
  if (!object(value.data) || !object(value.data.message)) return invalid('Read the chat journal to hydrate this historical event')
  const message = value.data.message
  if (!id(value.id) || !id(message.id) || !id(message.chat_id) || !id(message.from) || message.direction !== 'inbound') {
    return invalid('Incoming message requires a stable identity, conversation and owned destination')
  }
  if (value.data.chat_id !== undefined && value.data.chat_id !== message.chat_id) return invalid('Chat identity mismatch')
  if (!Array.isArray(message.parts) || !message.parts.length || message.parts.length > 50) return invalid('Invalid message parts')
  const text: string[] = []
  for (const part of message.parts) {
    if (!object(part) || part.type !== 'text' || typeof part.body !== 'string' || part.body.length > 4096) {
      return { ok: false, code: 'unsupported_event', message: 'This message requires non-text handling' }
    }
    text.push(part.body)
  }
  const occurredAt = typeof message.created_at === 'string' ? Date.parse(message.created_at) : NaN
  if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) return invalid('Invalid message timestamp')
  return { ok: true, event: {
    version: 1, provider: 'linq-whatsapp', eventType: input.type, operation: 'created', eventId: message.id,
    conversationId: message.chat_id, parentEventIds: [],
    sender: { id: `customer:${message.chat_id}`, address: null, displayName: null },
    destinations: [{ kind: 'chat', id: message.from, address: message.from, displayName: null }],
    subject: null, text: text.join('\n'), html: null, attachments: [], occurredAt, isGroup: false,
  } }
}
