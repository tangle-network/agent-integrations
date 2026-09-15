import {
  normalizeConversationEvent as normalizeExistingConversationEvent,
  type ConversationEvent as ExistingConversationEvent,
  type ConversationEventNormalizationResult as ExistingNormalizationResult,
} from './core.js'
import { normalizeLinqWhatsappConversation } from './linq-whatsapp.js'
import { normalizeMobileConversation } from './mobile.js'

export * from './core.js'
export { buildMessagingReply, type ConversationReply } from './reply.js'
export { listConversationChannels, type ConversationChannel } from './channels.js'

/** Additive provider vocabulary. Neither sender identity nor group membership is authority. */
export interface ConversationEvent extends Omit<ExistingConversationEvent, 'provider'> {
  provider: ExistingConversationEvent['provider'] | 'inkbox' | 'linq' | 'contiguity' | 'linq-whatsapp'
  isGroup?: boolean
  /** Historical or incomplete input is not a new automatic command. */
  historyOnly?: boolean
}
export type ConversationEventNormalizationResult =
  | { ok: true; event: ConversationEvent }
  | Exclude<ExistingNormalizationResult, { ok: true }>

export function normalizeConversationEvent(value: unknown): ConversationEventNormalizationResult {
  if (value && typeof value === 'object' && 'provider' in value
    && ['inkbox', 'linq', 'contiguity', 'linq-whatsapp'].includes(String(value.provider))) {
    if (!('type' in value) || typeof value.type !== 'string' || !('payload' in value)) {
      return { ok: false, code: 'invalid_payload', message: 'Provider event requires type and payload' }
    }
    if (value.provider === 'linq-whatsapp') return normalizeLinqWhatsappConversation({ provider: value.provider, type: value.type, payload: value.payload })
    return normalizeMobileConversation({ provider: String(value.provider), type: value.type, payload: value.payload })
  }
  return normalizeExistingConversationEvent(value)
}
