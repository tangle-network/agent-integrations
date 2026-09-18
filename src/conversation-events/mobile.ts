import type { ConversationAttachment, ConversationEvent, ConversationEventNormalizationResult, ProviderConversationEvent } from './index.js'

type RecordValue = Record<string, unknown>
function record(value: unknown): value is RecordValue { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function string(value: unknown, max = 2000): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : null
}
function timestamp(value: unknown): number | null {
  const n = typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}
const invalid = (message: string): ConversationEventNormalizationResult => ({ ok: false, code: 'invalid_payload', message })
const unsupported = (): ConversationEventNormalizationResult => ({ ok: false, code: 'unsupported_event', message: 'Not a supported incoming conversation message' })

function attachment(value: unknown): ConversationAttachment | null {
  if (!record(value)) return null
  const url = string(value.url ?? value.value, 8192)
  if (!url) return null
  try { const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password) return null } catch { return null }
  return { id: string(value.id), name: string(value.filename ?? value.name, 255),
    contentType: string(value.mime_type ?? value.mime ?? value.content_type, 200), size: null, contentBase64: null, url }
}

function finish(input: ProviderConversationEvent, data: {
  id: unknown; conversation: unknown; sender: unknown; destination: unknown;
  destinationAddress?: unknown; text: unknown; time: unknown; media?: unknown; parent?: unknown;
  subject?: unknown; destinationKind?: 'chat' | 'mailbox'; isGroup?: boolean; historyOnly?: boolean;
}): ConversationEventNormalizationResult {
  const id = string(data.id), conversation = string(data.conversation), sender = string(data.sender), destination = string(data.destination)
  if (!id || !conversation || !sender || !destination) return invalid('Message identity, conversation, sender and destination are required')
  if (data.text !== null && data.text !== undefined && (typeof data.text !== 'string' || data.text.length > 1_000_000)) return invalid('Invalid message text')
  if (data.media !== undefined && data.media !== null && (!Array.isArray(data.media) || data.media.length > 50)) return invalid('Invalid attachment list')
  const media = (data.media ?? []) as unknown[]
  const attachments = media.map(attachment)
  if (attachments.some((a) => !a)) return invalid('Attachments require HTTPS references; bytes must be resolved through the authorized file boundary')
  const time = timestamp(data.time)
  if (time === null) return invalid('A valid provider timestamp is required')
  const provider = input.provider as 'inkbox' | 'linq' | 'contiguity'
  const event: ConversationEvent = {
    version: 1, provider, eventType: input.type, operation: 'created', eventId: id,
    conversationId: conversation, parentEventIds: string(data.parent) ? [String(data.parent)] : [],
    sender: { id: sender, address: sender, displayName: null },
    destinations: [{ kind: data.destinationKind ?? 'chat', id: destination, address: string(data.destinationAddress), displayName: null }],
    subject: string(data.subject, 998), text: (data.text as string | null | undefined) ?? null, html: null,
    attachments: attachments as ConversationAttachment[], occurredAt: time,
    isGroup: data.isGroup === true, historyOnly: data.historyOnly === true,
  }
  return { ok: true, event }
}

/** Called after the host verifies signatures and resolves the owning connection. */
export function normalizeMobileConversation(input: ProviderConversationEvent): ConversationEventNormalizationResult {
  const p = input.payload
  if (!record(p) || !record(p.data)) return invalid('Provider payload requires a data object')
  const data = p.data
  if (input.provider === 'inkbox') {
    if (input.type !== `inkbox.${p.event_type}`) return invalid('Event type does not match the provider envelope')
    if (p.event_type === 'imessage.received') {
      const m = data.message
      if (!record(m) || m.direction !== 'inbound') return invalid('Expected an inbound iMessage')
      return finish(input, { id: m.id, conversation: m.conversation_id, sender: m.sender_number ?? m.remote_number,
        destination: m.conversation_id, text: m.content, time: m.created_at ?? p.timestamp, media: m.media, isGroup: m.is_group === true })
    }
    if (p.event_type === 'text.received') {
      const m = data.text_message
      if (!record(m) || m.direction !== 'inbound') return invalid('Expected an inbound phone text')
      return finish(input, { id: m.id, conversation: m.conversation_id, sender: m.sender_phone_number ?? m.remote_phone_number,
        destination: m.local_phone_number, destinationAddress: m.local_phone_number, text: m.text, time: m.created_at ?? p.timestamp,
        media: m.media, isGroup: m.is_group === true })
    }
    if (p.event_type === 'message.received') {
      const m = data.message
      if (!record(m) || m.direction !== 'inbound') return invalid('Expected inbound mail')
      return finish(input, { id: m.id, conversation: m.thread_id ?? m.id, sender: m.from_address,
        destination: m.email_address, destinationAddress: m.email_address, destinationKind: 'mailbox', text: m.body,
        time: m.created_at ?? p.timestamp, subject: m.subject,
        historyOnly: m.body_state !== 'complete' || m.body_truncated === true })
    }
    return unsupported()
  }
  if (input.provider === 'linq') {
    if (input.type !== `linq.${p.event_type}`) return invalid('Event type does not match the provider envelope')
    if (p.event_type !== 'message.received') return unsupported()
    if (p.webhook_version !== '2026-02-03' || data.direction !== 'inbound' || !record(data.chat)
      || !record(data.sender_handle) || !record(data.chat.owner_handle) || data.chat.owner_handle.is_me !== true || data.sender_handle.is_me === true) {
      return invalid('Linq requires v2026-02-03 incoming payloads with explicit sender and owner handles')
    }
    if (!Array.isArray(data.parts) || data.parts.length > 50) return invalid('Invalid Linq parts')
    const texts: string[] = [], media: RecordValue[] = []
    for (const part of data.parts) {
      if (!record(part)) return invalid('Invalid Linq part')
      if (part.type === 'text' || part.type === 'link') {
        if (typeof part.value !== 'string') return invalid('Invalid Linq text')
        texts.push(part.value)
      } else if (part.type === 'media') media.push(part)
      else return unsupported()
    }
    return finish(input, { id: data.id, conversation: data.chat.id, sender: data.sender_handle.handle,
      destination: data.chat.id, destinationAddress: data.chat.owner_handle.handle,
      text: texts.join('\n'), time: data.sent_at ?? p.created_at, media,
      parent: record(data.reply_to) ? data.reply_to.message_id : undefined,
      isGroup: data.chat.is_group === true, historyOnly: data.reconciled_at != null || data.zero_retention === true })
  }
  if (input.provider === 'contiguity') {
    if (input.type !== `contiguity.${p.type}`) return invalid('Event type does not match the provider envelope')
    if (!['imessage.incoming', 'text.incoming.sms', 'text.incoming.mms'].includes(String(p.type))) return unsupported()
    if (!string(data.to, 320) || !string(data.from, 320)) return invalid('Missing Contiguity phone routing')
    // No native chat id in v2: use a collision-free tuple, not a bare sender across channels.
    return finish(input, { id: p.id, conversation: JSON.stringify([p.type === 'imessage.incoming' ? 'imessage' : 'text', data.to, data.from]),
      sender: data.from, destination: data.to, destinationAddress: data.to, text: data.body,
      time: data.timestamp ?? p.timestamp, media: data.attachments })
  }
  return { ok: false, code: 'unsupported_provider', message: 'Unsupported mobile provider' }
}
