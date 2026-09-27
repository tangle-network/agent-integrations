import { normalizeConversationEvent, type ConversationEventNormalizationResult, type ProviderConversationEvent } from './index.js'
import { listConversationChannels } from './channels.js'

export type ConversationReaction = 'like' | 'love' | 'laugh' | 'emphasize' | 'question' | 'dislike'
const whatsappEmoji: Record<ConversationReaction, string> = {
  like: '👍', love: '❤️', laugh: '😂', emphasize: '‼️', question: '❓', dislike: '👎',
}

export interface ConversationPresenceCapabilities {
  reaction: boolean
  typing: boolean
  readReceipt: boolean
}

/** An action plan only. The host rechecks line and connection authority before invoking it. */
export interface ConversationPresenceAction {
  action: string
  input: Record<string, unknown>
  idempotencyKey: string
}

type Failure = Exclude<ConversationEventNormalizationResult, { ok: true }>
type Result = { ok: true; plan: ConversationPresenceAction } | Failure
const unsupported = (message: string): Failure => ({ ok: false, code: 'unsupported_event', message })
const invalid = (message: string): Failure => ({ ok: false, code: 'invalid_payload', message })
const none = (): ConversationPresenceCapabilities => ({ reaction: false, typing: false, readReceipt: false })

function eligible(input: ProviderConversationEvent) {
  const normalized = normalizeConversationEvent(input)
  if (!normalized.ok) return normalized
  const event = normalized.event
  if (event.historyOnly || event.isGroup || !event.transport) return unsupported('Presence requires a current one-to-one message with a known transport')
  const channel = listConversationChannels().find(row => row.providerId === event.provider
    && row.eventType === event.eventType && row.transport === event.transport)
  if (!channel) return unsupported('No presence actions are available for this channel')
  return { ok: true as const, event, channel }
}

function operation(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && /^[\x21-\x7e]+$/.test(value)
}
function target(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
}

/** Protocol support for this authenticated, stored inbound event; account readiness is checked by the host. */
export function conversationPresenceCapabilities(input: ProviderConversationEvent): ConversationPresenceCapabilities {
  const matched = eligible(input)
  if (!matched.ok) return none()
  return {
    reaction: Boolean(matched.channel.reactionAction && target(matched.event.eventId)),
    typing: Boolean(matched.channel.typingAction && target(matched.event.conversationId)),
    readReceipt: Boolean(matched.channel.readReceiptAction && target(matched.event.conversationId)),
  }
}

function plan(input: ProviderConversationEvent, operationId: string, kind: 'reaction' | 'typing' | 'readReceipt', reaction?: ConversationReaction): Result {
  const matched = eligible(input)
  if (!matched.ok) return matched
  if (!operation(operationId)) return invalid('A stable bounded operation id is required')
  const { event, channel } = matched
  const action = kind === 'reaction' ? channel.reactionAction : kind === 'typing' ? channel.typingAction : channel.readReceiptAction
  if (!action) return unsupported('This channel does not support the requested presence action')
  const inputKey = kind === 'reaction' ? 'message_id' : event.provider === 'inkbox' ? 'conversation_id' : 'chat_id'
  const id = kind === 'reaction' ? event.eventId : event.conversationId
  if (!target(id)) return invalid('Provider message or conversation id is missing or invalid')
  const args: Record<string, unknown> = { [inputKey]: id }
  if (kind === 'reaction' && event.provider === 'linq-whatsapp') {
    if (!target(event.conversationId)) return invalid('WhatsApp chat id is missing or invalid')
    args.chat_id = event.conversationId
  }
  if (kind === 'reaction') {
    if (!reaction || !(['like', 'love', 'laugh', 'emphasize', 'question', 'dislike'] as string[]).includes(reaction)) {
      return invalid('Unsupported reaction')
    }
    if (event.provider === 'linq-whatsapp') args.emoji = whatsappEmoji[reaction]
    else args.reaction = reaction
  }
  return { ok: true, plan: { action, input: args, idempotencyKey: operationId } }
}

export function buildConversationReaction(input: ProviderConversationEvent, reaction: ConversationReaction, operationId: string): Result {
  return plan(input, operationId, 'reaction', reaction)
}
export function buildConversationTyping(input: ProviderConversationEvent, operationId: string): Result {
  return plan(input, operationId, 'typing')
}
export function buildConversationReadReceipt(input: ProviderConversationEvent, operationId: string): Result {
  return plan(input, operationId, 'readReceipt')
}
