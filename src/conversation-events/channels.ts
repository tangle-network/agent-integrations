/** Protocol metadata, not a claim that a deployment or account is configured. */
export interface ConversationChannel {
  providerId: string
  eventType: string
  label: string
  transport: 'email' | 'imessage' | 'sms' | 'whatsapp'
  sourceKind: 'channel' | 'connection'
  replies: boolean
  inventoryAction?: string
  replyAction?: string
  numberProvisioning?: 'provider-assigned'
}

const channels: readonly ConversationChannel[] = [
  { providerId: 'email', eventType: 'email.received', label: 'Tangle email', transport: 'email', sourceKind: 'channel', replies: false },
  { providerId: 'inkbox', eventType: 'inkbox.imessage.received', label: 'iMessage', transport: 'imessage', sourceKind: 'connection', replies: true },
  { providerId: 'inkbox', eventType: 'inkbox.text.received', label: 'SMS', transport: 'sms', sourceKind: 'connection', replies: true },
  { providerId: 'inkbox', eventType: 'inkbox.message.received', label: 'Email', transport: 'email', sourceKind: 'connection', replies: true },
  { providerId: 'linq', eventType: 'linq.message.received', label: 'iMessage / SMS', transport: 'imessage', sourceKind: 'connection', replies: true, inventoryAction: 'linq.numbers.list', replyAction: 'linq.messages.reply', numberProvisioning: 'provider-assigned' },
  { providerId: 'contiguity', eventType: 'contiguity.imessage.incoming', label: 'iMessage', transport: 'imessage', sourceKind: 'connection', replies: true },
  { providerId: 'contiguity', eventType: 'contiguity.text.incoming.sms', label: 'SMS', transport: 'sms', sourceKind: 'connection', replies: true },
  { providerId: 'linq-whatsapp', eventType: 'linq-whatsapp.message.received', label: 'WhatsApp', transport: 'whatsapp', sourceKind: 'connection', replies: true, inventoryAction: 'linq-whatsapp.numbers.list', replyAction: 'linq-whatsapp.messages.reply' },
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
  channel: 'imessage' | 'whatsapp'
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
