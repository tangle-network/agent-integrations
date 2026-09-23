import type { ConversationEventNormalizationResult, ProviderConversationEvent } from './index.js'
import { linqWhatsappAttachmentUrl } from '../linq-whatsapp-attachment-url.js'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
}
const invalid = (message: string): ConversationEventNormalizationResult => ({ ok: false, code: 'invalid_payload', message })
const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'document', 'sticker'])

function mediaPart(part: Record<string, unknown>) {
  if (typeof part.kind !== 'string' || !MEDIA_KINDS.has(part.kind)) return null
  const url = part.url == null ? null : linqWhatsappAttachmentUrl(part.url)
  if (part.url != null && !url) return null
  if (!id(part.media_id)) return null
  if (part.filename !== undefined && (typeof part.filename !== 'string' || part.filename.length > 240 || /[\u0000-\u001f\u007f]/.test(part.filename))) return null
  if (part.mime_type !== undefined && (typeof part.mime_type !== 'string' || part.mime_type.length > 200 || /[\u0000-\u001f\u007f]/.test(part.mime_type))) return null
  if (part.caption !== undefined && (typeof part.caption !== 'string' || part.caption.length > 1024)) return null
  if (part.byte_size !== undefined && (!Number.isSafeInteger(part.byte_size) || (part.byte_size as number) < 0)) return null
  return {
    attachment: { id: typeof part.media_id === 'string' ? part.media_id : null,
      name: typeof part.filename === 'string' ? part.filename : null,
      contentType: typeof part.mime_type === 'string' ? part.mime_type : null,
      size: typeof part.byte_size === 'number' ? part.byte_size : null,
      contentBase64: null, url },
    caption: typeof part.caption === 'string' && part.caption.length <= 1024 ? part.caption : null,
  }
}

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
  const attachments: NonNullable<ReturnType<typeof mediaPart>>['attachment'][] = []
  let historyOnly = false
  for (const part of message.parts) {
    if (!object(part)) return invalid('Invalid message part')
    if (part.type === 'media') {
      const media = mediaPart(part)
      if (!media) return invalid('Invalid media attachment')
      attachments.push(media.attachment)
      if (media.caption) text.push(media.caption)
      if (!media.attachment.url) historyOnly = true
    } else if (part.type === 'text' && typeof part.body === 'string' && part.body.length <= 4096) {
      text.push(part.body)
    } else {
      return { ok: false, code: 'unsupported_event', message: 'This message requires non-text handling' }
    }
  }
  const occurredAt = typeof message.created_at === 'string' ? Date.parse(message.created_at) : NaN
  if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) return invalid('Invalid message timestamp')
  return { ok: true, event: {
    version: 1, provider: 'linq-whatsapp', eventType: input.type, operation: 'created', eventId: message.id,
    conversationId: message.chat_id, parentEventIds: [],
    sender: { id: `customer:${message.chat_id}`, address: null, displayName: null },
    destinations: [{ kind: 'chat', id: message.from, address: message.from, displayName: null }],
    subject: null, text: text.join('\n'), html: null, attachments, occurredAt, isGroup: false, historyOnly,
  } }
}
