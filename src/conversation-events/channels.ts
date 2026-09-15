/** Protocol metadata, not a claim that a deployment or account is configured. */
export interface ConversationChannel {
  providerId: string
  eventType: string
  label: string
  transport: 'email' | 'imessage' | 'sms' | 'whatsapp'
  sourceKind: 'channel' | 'connection'
  replies: boolean
}

const channels: readonly ConversationChannel[] = [
  { providerId: 'email', eventType: 'email.received', label: 'Tangle email', transport: 'email', sourceKind: 'channel', replies: false },
  { providerId: 'inkbox', eventType: 'inkbox.imessage.received', label: 'iMessage', transport: 'imessage', sourceKind: 'connection', replies: true },
  { providerId: 'inkbox', eventType: 'inkbox.text.received', label: 'SMS', transport: 'sms', sourceKind: 'connection', replies: true },
  { providerId: 'inkbox', eventType: 'inkbox.message.received', label: 'Email', transport: 'email', sourceKind: 'connection', replies: true },
  { providerId: 'linq', eventType: 'linq.message.received', label: 'iMessage / SMS', transport: 'imessage', sourceKind: 'connection', replies: true },
  { providerId: 'contiguity', eventType: 'contiguity.imessage.incoming', label: 'iMessage', transport: 'imessage', sourceKind: 'connection', replies: true },
  { providerId: 'contiguity', eventType: 'contiguity.text.incoming.sms', label: 'SMS', transport: 'sms', sourceKind: 'connection', replies: true },
  { providerId: 'linq-whatsapp', eventType: 'linq-whatsapp.message.received', label: 'WhatsApp', transport: 'whatsapp', sourceKind: 'connection', replies: true },
]

/** Fresh copies let applications filter by their live Hub catalog without mutating ours. */
export function listConversationChannels(): ConversationChannel[] {
  return channels.map(channel => ({ ...channel }))
}
