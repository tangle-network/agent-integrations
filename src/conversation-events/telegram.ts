import type { ConversationAttachment, ConversationEventNormalizationResult, ProviderConversationEvent } from './index.js'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function integer(value: unknown, positive = true): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (positive ? value > 0 : value !== 0)
}
const invalid = (message: string): ConversationEventNormalizationResult => ({ ok: false, code: 'invalid_payload', message })

/** Parse only new human messages. The verified webhook proves origin; the host
 * must still check live bot membership and the sender's authority before acting.
 * Addresses include chat, forum topic and sender to prevent session reuse across
 * groups, topics or people. Anonymous/channel senders cannot acquire user rights. */
export function normalizeTelegramConversation(input: ProviderConversationEvent): ConversationEventNormalizationResult {
  if (input.type !== 'telegram.message') return { ok: false, code: 'unsupported_event', message: 'Not a new Telegram message' }
  const envelope = input.payload
  if (!object(envelope) || !Number.isSafeInteger(envelope.update_id)
    || (envelope.update_id as number) < 0 || !object(envelope.message)) {
    return invalid('Telegram requires an update id and message')
  }
  const message = envelope.message
  const chat = message.chat
  const from = message.from
  if (!object(chat) || !object(from) || !integer(chat.id, false) || !integer(from.id)
    || from.is_bot !== false || message.sender_chat !== undefined || !integer(message.message_id)
    || !integer(message.date) || !Number.isSafeInteger(message.date * 1000)
    || !['private', 'group', 'supergroup'].includes(String(chat.type))
    || (chat.type === 'private' ? chat.id !== from.id : chat.id >= 0)) {
    return invalid('Telegram requires a human sender and supported chat identity')
  }
  const topic = message.message_thread_id
  if (topic !== undefined && (!integer(topic) || chat.type !== 'supergroup')) return invalid('Invalid Telegram topic')
  const text = message.text ?? message.caption ?? ''
  if (typeof text !== 'string' || text.length > 4096 || text.includes('\0')) return invalid('Invalid Telegram message text')
  const media: unknown[] = []
  if (message.photo !== undefined) {
    if (!Array.isArray(message.photo) || message.photo.length === 0 || message.photo.length > 20) return invalid('Invalid Telegram photo')
    media.push(message.photo[message.photo.length - 1])
  }
  for (const kind of ['document', 'audio', 'voice', 'video', 'video_note', 'animation', 'sticker']) {
    if (message[kind] !== undefined) media.push(message[kind])
  }
  const attachments: ConversationAttachment[] = []
  for (const file of media) {
    if (!object(file) || typeof file.file_id !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(file.file_id)
      || (file.file_size !== undefined && (!Number.isSafeInteger(file.file_size) || (file.file_size as number) < 0))) {
      return invalid('Invalid Telegram attachment')
    }
    attachments.push({ id: file.file_id, name: typeof file.file_name === 'string' ? file.file_name.slice(0, 255) : null,
      contentType: typeof file.mime_type === 'string' ? file.mime_type.slice(0, 200) : null,
      size: typeof file.file_size === 'number' ? file.file_size : null, contentBase64: null, url: null })
  }
  if (!text.trim() && attachments.length === 0) return { ok: false, code: 'unsupported_event', message: 'No message content' }
  return { ok: true, event: {
    version: 1, provider: 'telegram', eventType: input.type, operation: 'created',
    eventId: `${chat.id}:${message.message_id}`, conversationId: String(chat.id),
    parentEventIds: object(message.reply_to_message) && integer(message.reply_to_message.message_id)
      ? [`${chat.id}:${message.reply_to_message.message_id}`] : [],
    sender: { id: String(from.id), address: `telegram:${chat.id}:${topic ?? 0}:${from.id}`,
      displayName: typeof from.first_name === 'string' ? from.first_name.slice(0, 100) : null },
    destinations: [{ kind: 'chat', id: String(chat.id), address: `telegram:${chat.id}`, displayName: null }],
    subject: null, text, html: null, attachments, occurredAt: message.date * 1000,
    transport: 'telegram', isGroup: chat.type !== 'private', historyOnly: false,
  } }
}
