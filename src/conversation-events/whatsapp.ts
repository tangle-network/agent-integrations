import type { ConversationEventNormalizationResult, ProviderConversationEvent } from './index.js'
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v)
const invalid = (message: string): ConversationEventNormalizationResult => ({ ok: false, code: 'invalid_payload', message })

/** Only a current individual customer message is executable. Media is retained as
 * a descriptor, never fetched or relabeled as understood text by this adapter. */
export function normalizeMetaWhatsappConversation(input: ProviderConversationEvent): ConversationEventNormalizationResult {
  const { provider, payload: p } = input
  if ((provider !== 'whatsapp' && provider !== 'whatsapp-business') || input.type !== `${provider}.message.received`)
    return { ok: false, code: 'unsupported_event', message: 'Not an incoming Meta WhatsApp message' }
  if (!record(p) || !/^\d{1,64}$/.test(String(p.wabaId)) || !/^\d{1,64}$/.test(String(p.phoneNumberId)) || !record(p.message)) return invalid('Missing Meta account and number binding')
  const m = p.message
  if (!id(m.id) || typeof m.from !== 'string' || !/^[1-9]\d{6,14}$/.test(m.from)
    || m.group_id !== undefined || m.recipient_type === 'group'
    || typeof m.timestamp !== 'string' || !/^\d{1,12}$/.test(m.timestamp)) return invalid('Incoming message requires an individual sender, identity and timestamp')
  const occurredAt = Number(m.timestamp) * 1000
  if (!Number.isSafeInteger(occurredAt) || occurredAt <= 0) return invalid('Invalid message timestamp')
  let text = ''
  const attachments = []
  if (m.type === 'text') {
    if (!record(m.text) || typeof m.text.body !== 'string' || !m.text.body.trim() || m.text.body.length > 4096 || m.text.body.includes('\0')) return invalid('Invalid WhatsApp text')
    text = m.text.body
  } else if (typeof m.type === 'string' && ['image','video','audio','document','sticker'].includes(m.type)) {
    const media = m[m.type]
    if (!record(media) || !id(media.id) || (media.mime_type !== undefined && !id(media.mime_type))
      || (media.filename !== undefined && !id(media.filename))
      || (media.caption !== undefined && (typeof media.caption !== 'string' || media.caption.length > 1024))) return invalid('Invalid WhatsApp media')
    attachments.push({ id: media.id, name: typeof media.filename === 'string' ? media.filename : null,
      contentType: typeof media.mime_type === 'string' ? media.mime_type : null, size: null, contentBase64: null, url: null })
    text = typeof media.caption === 'string' ? media.caption : ''
  } else return { ok: false, code: 'unsupported_event', message: 'This WhatsApp message type is not supported' }
  return { ok: true, event: {
    version: 1, provider, eventType: input.type, operation: 'created', eventId: m.id,
    conversationId: `${p.phoneNumberId}:${m.from}`, parentEventIds: [],
    sender: { id: m.from, address: `+${m.from}`, displayName: null },
    destinations: [{ kind: 'chat', id: String(p.phoneNumberId), address: null, displayName: null }],
    subject: null, text, html: null, attachments, occurredAt, transport: 'whatsapp', isGroup: false, historyOnly: false,
  } }
}
