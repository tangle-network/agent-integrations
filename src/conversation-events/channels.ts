/** Protocol metadata, not a claim that a deployment or account is configured. */
export interface ConversationChannel {
  providerId: string
  eventType: string
  label: string
  transport: 'email' | 'imessage' | 'sms' | 'whatsapp'
  sourceKind: 'channel' | 'connection'
  replies: boolean
  inventoryAction?: string
  numberProvisioning?: 'provider-assigned'
}

const channels: readonly ConversationChannel[] = [
  { providerId: 'email', eventType: 'email.received', label: 'Tangle email', transport: 'email', sourceKind: 'channel', replies: false },
  { providerId: 'inkbox', eventType: 'inkbox.imessage.received', label: 'iMessage', transport: 'imessage', sourceKind: 'connection', replies: true },
  { providerId: 'inkbox', eventType: 'inkbox.text.received', label: 'SMS', transport: 'sms', sourceKind: 'connection', replies: true },
  { providerId: 'inkbox', eventType: 'inkbox.message.received', label: 'Email', transport: 'email', sourceKind: 'connection', replies: true },
  { providerId: 'linq', eventType: 'linq.message.received', label: 'iMessage / SMS', transport: 'imessage', sourceKind: 'connection', replies: true, inventoryAction: 'linq.phone_numbers.list', numberProvisioning: 'provider-assigned' },
  { providerId: 'contiguity', eventType: 'contiguity.imessage.incoming', label: 'iMessage', transport: 'imessage', sourceKind: 'connection', replies: true },
  { providerId: 'contiguity', eventType: 'contiguity.text.incoming.sms', label: 'SMS', transport: 'sms', sourceKind: 'connection', replies: true },
  { providerId: 'linq-whatsapp', eventType: 'linq-whatsapp.message.received', label: 'WhatsApp', transport: 'whatsapp', sourceKind: 'connection', replies: true },
]

/** Fresh copies let applications filter by their live Hub catalog without mutating ours. */
export function listConversationChannels(): ConversationChannel[] {
  return channels.map(channel => ({ ...channel }))
}


export interface ConversationEndpointOption {
  id: string; address: string; providerId: string; channel: 'imessage'
  health: 'healthy' | 'at-risk' | 'critical' | 'unknown'
}
/** Project an authenticated provider-owned inventory response, not user input.
 * Protocol shape stays here with the adapter; applications never guess addresses. */
export function conversationEndpointOptions(providerId: string, result: unknown): ConversationEndpointOption[] {
  if (providerId !== 'linq') throw new Error('Owned endpoint enumeration is not available for this provider')
  if (!result || typeof result !== 'object' || !Array.isArray((result as { phone_numbers?: unknown }).phone_numbers)) {
    throw new Error('Linq did not return its owned phone-number inventory')
  }
  const values = (result as { phone_numbers: unknown[] }).phone_numbers
  if (values.length > 1000) throw new Error('Phone inventory exceeds the supported response limit')
  const seen = new Set<string>()
  return values.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid phone inventory row')
    const r = value as { id?: unknown; phone_number?: unknown; reputation?: { status?: unknown } }
    if (typeof r.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(r.id) || typeof r.phone_number !== 'string' ||
        !/^\+[1-9]\d{6,14}$/.test(r.phone_number) || seen.has(r.id) || seen.has(r.phone_number)) {
      throw new Error('Invalid or ambiguous owned phone-number identity')
    }
    seen.add(r.id); seen.add(r.phone_number)
    const health: ConversationEndpointOption['health'] = r.reputation?.status === 'HEALTHY' ? 'healthy' :
      r.reputation?.status === 'AT_RISK' ? 'at-risk' : r.reputation?.status === 'CRITICAL' ? 'critical' : 'unknown'
    return { id: r.id, address: r.phone_number, providerId, channel: 'imessage', health }
  })
}
