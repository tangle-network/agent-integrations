/** Protocol metadata, not a claim that a deployment or account is configured. */
export interface ConversationChannel {
  providerId: string
  eventType: string
  label: string
  transport: 'email' | 'imessage' | 'sms' | 'rcs' | 'whatsapp' | 'telegram'
  sourceKind: 'channel' | 'connection'
  replies: boolean
  inventoryAction?: string
  replyAction?: string
  reactionAction?: string
  typingAction?: string
  readReceiptAction?: string
  numberProvisioning?: 'provider-assigned'
}

const channels: readonly ConversationChannel[] = [
  { providerId: 'telegram', eventType: 'telegram.message', label: 'Telegram', transport: 'telegram', sourceKind: 'connection', replies: true, replyAction: 'telegram.sendMessage' },
  { providerId: 'email', eventType: 'email.received', label: 'Tangle email', transport: 'email', sourceKind: 'channel', replies: false },
  { providerId: 'inkbox', eventType: 'inkbox.imessage.received', label: 'iMessage', transport: 'imessage', sourceKind: 'connection', replies: true, replyAction: 'inkbox.imessage.reply',
    reactionAction: 'inkbox.imessage.react', typingAction: 'inkbox.imessage.typing', readReceiptAction: 'inkbox.imessage.read_receipt' },
  { providerId: 'inkbox', eventType: 'inkbox.text.received', label: 'SMS', transport: 'sms', sourceKind: 'connection', replies: true, replyAction: 'inkbox.sms.reply' },
  { providerId: 'inkbox', eventType: 'inkbox.message.received', label: 'Email', transport: 'email', sourceKind: 'connection', replies: true, replyAction: 'inkbox.email.send' },
  { providerId: 'linq', eventType: 'linq.message.received', label: 'iMessage', transport: 'imessage', sourceKind: 'connection', replies: true, inventoryAction: 'linq.numbers.list', replyAction: 'linq.messages.reply',
    reactionAction: 'linq.messages.react', typingAction: 'linq.chats.typing', readReceiptAction: 'linq.chats.read_receipt', numberProvisioning: 'provider-assigned' },
  { providerId: 'linq', eventType: 'linq.message.received', label: 'SMS', transport: 'sms', sourceKind: 'connection', replies: true, inventoryAction: 'linq.numbers.list', replyAction: 'linq.messages.reply', numberProvisioning: 'provider-assigned' },
  { providerId: 'linq', eventType: 'linq.message.received', label: 'RCS', transport: 'rcs', sourceKind: 'connection', replies: true, inventoryAction: 'linq.numbers.list', replyAction: 'linq.messages.reply', numberProvisioning: 'provider-assigned' },
  { providerId: 'contiguity', eventType: 'contiguity.imessage.incoming', label: 'iMessage', transport: 'imessage', sourceKind: 'connection', replies: true, replyAction: 'contiguity.messages.send_imessage',
    typingAction: 'contiguity.imessage.typing', readReceiptAction: 'contiguity.imessage.read_receipt' },
  { providerId: 'contiguity', eventType: 'contiguity.text.incoming.sms', label: 'SMS', transport: 'sms', sourceKind: 'connection', replies: true, replyAction: 'contiguity.sms.send' },
  { providerId: 'linq-whatsapp', eventType: 'linq-whatsapp.message.received', label: 'WhatsApp', transport: 'whatsapp', sourceKind: 'connection', replies: true, inventoryAction: 'linq-whatsapp.numbers.list', replyAction: 'linq-whatsapp.messages.reply',
    reactionAction: 'linq-whatsapp.messages.react', readReceiptAction: 'linq-whatsapp.chats.read_receipt' },
  { providerId: 'resend', eventType: 'resend.email.received', label: 'Email', transport: 'email', sourceKind: 'connection', replies: true, replyAction: 'resend.emails.reply' },
  { providerId: 'sendblue', eventType: 'sendblue.message.received', label: 'iMessage', transport: 'imessage', sourceKind: 'connection', replies: true, inventoryAction: 'sendblue.lines.state', replyAction: 'sendblue.messages.send',
    reactionAction: 'sendblue.messages.react', typingAction: 'sendblue.typing.send', readReceiptAction: 'sendblue.read_receipts.send' },
  { providerId: 'sendblue', eventType: 'sendblue.message.received', label: 'SMS', transport: 'sms', sourceKind: 'connection', replies: true, inventoryAction: 'sendblue.lines.state', replyAction: 'sendblue.messages.send' },
  { providerId: 'sendblue', eventType: 'sendblue.message.received', label: 'RCS', transport: 'rcs', sourceKind: 'connection', replies: true, inventoryAction: 'sendblue.lines.state', replyAction: 'sendblue.messages.send' },
  { providerId: 'twilio-sms', eventType: 'twilio-sms.message.received', label: 'SMS / MMS', transport: 'sms', sourceKind: 'connection', replies: true, inventoryAction: 'twilio-sms.list_numbers', replyAction: 'twilio-sms.send_sms' },
]

/** Fresh copies let applications filter by their live Hub catalog without mutating ours. */
export function listConversationChannels(): ConversationChannel[] {
  return channels.map(channel => ({ ...channel }))
}

export interface ConversationEndpointOption {
  id: string
  /** Provider display address. Use id, not a reformatted address, to select a resource. */
  address: string
  providerId: string
  channel: 'imessage' | 'sms' | 'whatsapp'
  health: 'healthy' | 'at-risk' | 'critical' | 'unknown'
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
}
/** Project an authenticated provider-owned inventory response, not user input.
 * Protocol shapes stay with the adapters. Unknown provider health remains unknown;
 * configuration, customer eligibility and delivery readiness are separate facts. */
export function conversationEndpointOptions(providerId: string, result: unknown): ConversationEndpointOption[] {
  if (providerId === 'sendblue') {
    const rows = record(result) ? result.data : null
    if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid Sendblue line-state inventory')
    const seen = new Set<string>()
    return rows.map(row => {
      if (!record(row) || !bounded(row.sendblue_number, 16)
        || !/^\+[1-9]\d{6,14}$/.test(row.sendblue_number) || seen.has(row.sendblue_number)) {
        throw new Error('Invalid or ambiguous Sendblue line identity')
      }
      seen.add(row.sendblue_number)
      const health: ConversationEndpointOption['health'] = row.status === 'ONLINE' ? 'healthy'
        : row.status === 'DEGRADED' ? 'at-risk' : row.status === 'OFFLINE' ? 'critical' : 'unknown'
      return { id: row.sendblue_number, address: row.sendblue_number,
        providerId, channel: 'imessage' as const, health }
    })
  }
  if (providerId === 'twilio-sms') {
    const rows = record(result) ? result.numbers : null
    if (!Array.isArray(rows) || rows.length > 1000 || (record(result) && result.nextPageUri)) {
      throw new Error('Twilio phone inventory is missing or incomplete')
    }
    const ids = new Set<string>(), addresses = new Set<string>()
    return rows.filter(row => {
      if (!record(row) || !record(row.capabilities) || typeof row.capabilities.sms !== 'boolean') {
        throw new Error('Invalid Twilio phone capability row')
      }
      return row.capabilities.sms
    }).map(row => {
      if (!bounded(row.sid, 34) || !/^PN[a-f0-9]{32}$/i.test(row.sid)
        || !bounded(row.phone_number, 16) || !/^\+[1-9]\d{6,14}$/.test(row.phone_number)
        || ids.has(row.sid) || addresses.has(row.phone_number)) {
        throw new Error('Invalid or ambiguous Twilio SMS number identity')
      }
      ids.add(row.sid); addresses.add(row.phone_number)
      return { id: row.sid, address: row.phone_number,
        providerId, channel: 'sms' as const, health: 'unknown' as const }
    })
  }
  if (providerId !== 'linq' && providerId !== 'linq-whatsapp') throw new Error('Owned endpoint enumeration is not available for this provider')
  const whatsapp = providerId === 'linq-whatsapp'
  const values = record(result) ? result[whatsapp ? 'data' : 'phone_numbers'] : null
  if (!Array.isArray(values)) throw new Error('Provider did not return its owned phone-number inventory')
  if (values.length > 1000) throw new Error('Phone inventory exceeds the supported response limit')
  const ids = new Set<string>(), addresses = new Set<string>()
  return values.map(value => {
    if (!record(value)) throw new Error('Invalid phone inventory row')
    const { id, phone_number: address } = value
    if (!bounded(id, 256) || !bounded(address, 320) || ids.has(id) || addresses.has(address)) {
      throw new Error('Invalid or ambiguous owned phone-number identity')
    }
    if (!whatsapp && (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id) || !/^\+[1-9]\d{6,14}$/.test(address))) {
      throw new Error('Invalid or ambiguous owned phone-number identity')
    }
    ids.add(id); addresses.add(address)
    const status = whatsapp ? value.quality_band : record(value.reputation) ? value.reputation.status : undefined
    // WhatsApp raw quality values evolve. Only its documented quality_band is classified.
    const health: ConversationEndpointOption['health'] = status === (whatsapp ? 'green' : 'HEALTHY') ? 'healthy'
      : status === (whatsapp ? 'yellow' : 'AT_RISK') ? 'at-risk'
      : status === (whatsapp ? 'red' : 'CRITICAL') ? 'critical' : 'unknown'
    return { id, address, providerId, channel: whatsapp ? 'whatsapp' as const : 'imessage' as const, health }
  })
}
