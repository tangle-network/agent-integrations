import type { TriggerEventCatalog } from '../webhooks/router.js'

export const MICROSOFT_TEAMS_PROVIDER_ID = 'microsoft-teams' as const
export const MICROSOFT_TEAMS_MESSAGE_EVENT = 'teams.message' as const

export const MICROSOFT_TEAMS_TRIGGER_EVENT_CATALOG = {
  namespace: 'teams.',
  closed: true,
  events: [{ id: MICROSOFT_TEAMS_MESSAGE_EVENT }],
} as const satisfies TriggerEventCatalog

export interface InboundEmailAttachment {
  filename?: string
  contentType?: string
  contentBase64?: string
  url?: string
  size?: number
}

/** Payload emitted by Tangle's verified inbound-email receiver. */
export interface InboundEmailPayload {
  messageId?: string
  from: string
  to: string
  subject?: string
  text?: string
  html?: string
  headers?: Record<string, string>
  attachments?: InboundEmailAttachment[]
  receivedAt?: number
}

export interface ProviderConversationEvent {
  provider: string
  type: string
  deliveryId?: string
  payload: unknown
}

export interface ConversationParticipant {
  id: string | null
  address: string | null
  displayName: string | null
}

export interface ConversationDestination {
  kind: 'mailbox' | 'channel' | 'chat' | 'user'
  id: string | null
  address: string | null
  displayName: string | null
}

export interface ConversationAttachment {
  id: string | null
  name: string | null
  contentType: string | null
  size: number | null
  contentBase64: string | null
  url: string | null
}

/**
 * Provider-neutral message data for product ingestion.
 *
 * The signed Hub delivery remains the audit record. This projection contains
 * only the stable fields products need for threading, prompts, and files.
 */
export interface ConversationEvent {
  version: 1
  provider: 'email' | 'slack' | 'teams'
  eventType: string
  operation: 'created' | 'updated' | 'deleted'
  eventId: string | null
  conversationId: string | null
  parentEventIds: string[]
  sender: ConversationParticipant
  destinations: ConversationDestination[]
  subject: string | null
  text: string | null
  html: string | null
  attachments: ConversationAttachment[]
  occurredAt: number | null
}

export type ConversationEventNormalizationErrorCode =
  | 'unsupported_provider'
  | 'unsupported_event'
  | 'invalid_payload'

export type ConversationEventNormalizationResult =
  | { ok: true; event: ConversationEvent }
  | {
      ok: false
      code: ConversationEventNormalizationErrorCode
      message: string
    }

const MAX_BODY_LENGTH = 1_000_000
const MAX_ATTACHMENTS = 50
const MAX_INLINE_ATTACHMENT_LENGTH = 1_100_000
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024
const MAX_HEADERS = 200

export function normalizeConversationEvent(
  value: unknown,
): ConversationEventNormalizationResult {
  if (
    !isRecord(value) ||
    typeof value.provider !== 'string' ||
    typeof value.type !== 'string' ||
    (value.deliveryId !== undefined &&
      typeof value.deliveryId !== 'string') ||
    !Object.prototype.hasOwnProperty.call(value, 'payload')
  ) {
    return invalidPayload(
      'Provider conversation event requires provider, type, and payload',
    )
  }
  const input: ProviderConversationEvent = {
    provider: value.provider,
    type: value.type,
    ...(typeof value.deliveryId === 'string'
      ? { deliveryId: value.deliveryId }
      : {}),
    payload: value.payload,
  }
  if (input.provider === 'email') {
    if (input.type !== 'email.received') {
      return unsupportedEvent(input.provider, input.type)
    }
    return normalizeEmail(input)
  }
  if (input.provider === 'slack') {
    if (input.type !== 'slack.message' && input.type !== 'slack.app_mention') {
      return unsupportedEvent(input.provider, input.type)
    }
    return normalizeSlack(input)
  }
  if (input.provider === MICROSOFT_TEAMS_PROVIDER_ID) {
    if (input.type !== MICROSOFT_TEAMS_MESSAGE_EVENT) {
      return unsupportedEvent(input.provider, input.type)
    }
    return normalizeMicrosoftTeams(input)
  }
  return {
    ok: false,
    code: 'unsupported_provider',
    message: `Conversation events do not support provider ${input.provider}`,
  }
}

function normalizeMicrosoftTeams(
  input: ProviderConversationEvent,
): ConversationEventNormalizationResult {
  const activity = input.payload
  if (!isRecord(activity) || activity.type !== 'message') {
    return invalidPayload('Teams payload requires a message activity')
  }
  if (
    activity.channelId !== undefined &&
    activity.channelId !== 'msteams'
  ) {
    return invalidPayload('Teams activity came from an unsupported channel')
  }
  const text = optionalString(activity.text, MAX_BODY_LENGTH)
  if (text === undefined) {
    return invalidPayload('Teams message text is invalid')
  }
  const conversation = isRecord(activity.conversation)
    ? activity.conversation
    : null
  const conversationId = normalizeNullableString(conversation?.id, 2_000)
  if (!conversationId) {
    return invalidPayload('Teams message requires a conversation id')
  }
  const channelData = isRecord(activity.channelData)
    ? activity.channelData
    : null
  const tenant = resolveMicrosoftTeamsTenantId(activity)
  if (!tenant.ok) return invalidPayload(tenant.message)
  const tenantId = tenant.tenantId
  const from = isRecord(activity.from) ? activity.from : null
  const channel = isRecord(channelData?.channel)
    ? channelData.channel
    : null
  const team = isRecord(channelData?.team) ? channelData.team : null
  const channelId = normalizeNullableString(channel?.id, 2_000)
  const channelName = normalizeNullableString(channel?.name, 300)
  const teamId = normalizeNullableString(team?.id, 2_000)
  const replyToId = normalizeNullableString(activity.replyToId, 2_000)
  const eventId =
    normalizeNullableString(activity.id, 2_000) ??
    normalizeNullableString(input.deliveryId, 2_000)
  const attachments = normalizeTeamsAttachments(activity.attachments)
  if (!attachments.ok) return attachments
  const timestamp = normalizeTeamsTimestamp(
    activity.timestamp ?? activity.localTimestamp,
  )
  if (timestamp === undefined) {
    return invalidPayload('Teams message timestamp is invalid')
  }

  return {
    ok: true,
    event: {
      version: 1,
      provider: 'teams',
      eventType: input.type,
      operation: 'created',
      eventId,
      conversationId: `${tenantId}:${conversationId}`,
      parentEventIds: replyToId ? [replyToId] : [],
      sender: {
        id:
          normalizeNullableString(from?.aadObjectId, 300) ??
          normalizeNullableString(from?.id, 2_000),
        address: null,
        displayName: normalizeNullableString(from?.name, 300),
      },
      destinations: [
        {
          kind: channelId ? 'channel' : 'chat',
          id: channelId ?? conversationId,
          address: null,
          displayName: channelName,
        },
        ...(teamId
          ? [
              {
                kind: 'channel' as const,
                id: teamId,
                address: null,
                displayName: normalizeNullableString(team?.name, 300),
              },
            ]
          : []),
      ],
      subject: null,
      text: text ?? null,
      html: null,
      attachments: attachments.value,
      occurredAt: timestamp ?? null,
    },
  }
}

export type MicrosoftTeamsTenantResolution =
  | { ok: true; tenantId: string }
  | { ok: false; message: string }

/**
 * Resolve the authenticated Teams tenant identity shared by the platform
 * receiver and product normalizer. Teams may repeat it in both
 * `channelData.tenant.id` and `conversation.tenantId`; disagreement is
 * rejected so an event can never be attributed to a guessed tenant.
 */
export function resolveMicrosoftTeamsTenantId(
  payload: unknown,
): MicrosoftTeamsTenantResolution {
  if (!isRecord(payload)) {
    return { ok: false, message: 'Teams payload requires an activity object' }
  }
  const conversation = isRecord(payload.conversation)
    ? payload.conversation
    : null
  const channelData = isRecord(payload.channelData)
    ? payload.channelData
    : null
  const channelDataTenant = isRecord(channelData?.tenant)
    ? normalizeNullableString(channelData.tenant.id, 300)
    : null
  const conversationTenant = normalizeNullableString(
    conversation?.tenantId,
    300,
  )
  if (
    channelDataTenant &&
    conversationTenant &&
    channelDataTenant !== conversationTenant
  ) {
    return {
      ok: false,
      message: 'Teams activity contains conflicting tenant ids',
    }
  }
  const tenantId = channelDataTenant ?? conversationTenant
  return tenantId
    ? { ok: true, tenantId }
    : { ok: false, message: 'Teams message requires a tenant id' }
}

function normalizeEmail(
  input: ProviderConversationEvent,
): ConversationEventNormalizationResult {
  const payload = input.payload
  if (!isRecord(payload)) return invalidPayload('Email payload must be an object')
  const from = optionalString(payload.from, 320)
  const to = optionalString(payload.to, 320)
  if (
    from === undefined ||
    from === null ||
    to === undefined ||
    to === null ||
    !from.trim() ||
    !to.trim()
  ) {
    return invalidPayload('Email payload requires non-empty string from and to')
  }
  const messageId = optionalString(payload.messageId, 1_000)
  const subject = optionalString(payload.subject, 2_000)
  const text = optionalString(payload.text, MAX_BODY_LENGTH)
  const html = optionalString(payload.html, MAX_BODY_LENGTH)
  if (
    messageId === undefined ||
    subject === undefined ||
    text === undefined ||
    html === undefined
  ) {
    return invalidPayload('Email payload contains an invalid string field')
  }
  const receivedAt = optionalFiniteNumber(payload.receivedAt, 0)
  if (receivedAt === undefined) {
    return invalidPayload('Email receivedAt must be a non-negative number')
  }
  const headers = normalizeHeaders(payload.headers)
  if (!headers.ok) return headers
  const attachments = normalizeEmailAttachments(payload.attachments)
  if (!attachments.ok) return attachments

  return {
    ok: true,
    event: {
      version: 1,
      provider: 'email',
      eventType: input.type,
      operation: 'created',
      eventId:
        normalizeMessageId(messageId) ??
        normalizeNullableString(input.deliveryId, 1_000),
      conversationId: null,
      parentEventIds: referencedMessageIds(headers.value),
      sender: {
        id: null,
        address: normalizeNullableString(from, 320),
        displayName: null,
      },
      destinations: [
        {
          kind: 'mailbox',
          id: null,
          address: normalizeMailbox(to),
          displayName: null,
        },
      ],
      subject: normalizeNullableString(subject, 2_000),
      text: text ?? null,
      html: html ?? null,
      attachments: attachments.value,
      occurredAt: receivedAt ?? null,
    },
  }
}

function normalizeSlack(
  input: ProviderConversationEvent,
): ConversationEventNormalizationResult {
  const wrapper = input.payload
  if (!isRecord(wrapper) || !isRecord(wrapper.event)) {
    return invalidPayload('Slack payload requires an Events API event object')
  }
  const outerEvent = wrapper.event
  const changedMessage =
    outerEvent.subtype === 'message_changed' && isRecord(outerEvent.message)
      ? outerEvent.message
      : null
  const deletedMessage =
    outerEvent.subtype === 'message_deleted' &&
    isRecord(outerEvent.previous_message)
      ? outerEvent.previous_message
      : null
  const message = changedMessage ?? deletedMessage ?? outerEvent
  if (
    message.type !== 'message' &&
    input.type !== 'slack.app_mention'
  ) {
    return invalidPayload('Slack event does not contain a message')
  }
  const text = optionalString(message.text, MAX_BODY_LENGTH)
  if (text === undefined) {
    return invalidPayload('Slack message text is invalid')
  }
  const channel =
    normalizeNullableString(outerEvent.channel, 300) ??
    normalizeNullableString(message.channel, 300)
  if (!channel) return invalidPayload('Slack message requires a channel')
  const timestamp =
    normalizeNullableString(message.ts, 100) ??
    normalizeNullableString(outerEvent.event_ts, 100)
  const threadTimestamp = normalizeNullableString(message.thread_ts, 100)
  const team =
    normalizeNullableString(wrapper.team_id, 300) ??
    normalizeNullableString(wrapper.context_team_id, 300)
  const rootTimestamp = threadTimestamp ?? timestamp
  const files = normalizeSlackFiles(message.files)
  if (!files.ok) return files
  const subtype = normalizeNullableString(outerEvent.subtype, 100)

  return {
    ok: true,
    event: {
      version: 1,
      provider: 'slack',
      eventType: input.type,
      operation:
        subtype === 'message_deleted'
          ? 'deleted'
          : subtype === 'message_changed'
            ? 'updated'
            : 'created',
      eventId:
        normalizeNullableString(wrapper.event_id, 300) ??
        normalizeNullableString(message.client_msg_id, 300) ??
        normalizeNullableString(input.deliveryId, 300) ??
        timestamp,
      conversationId: rootTimestamp
        ? [team, channel, rootTimestamp].filter(Boolean).join(':')
        : null,
      parentEventIds:
        threadTimestamp && timestamp && threadTimestamp !== timestamp
          ? [threadTimestamp]
          : [],
      sender: {
        id:
          normalizeNullableString(message.user, 300) ??
          normalizeNullableString(message.bot_id, 300),
        address: null,
        displayName:
          normalizeNullableString(message.username, 300) ??
          (isRecord(message.user_profile)
            ? normalizeNullableString(
                message.user_profile.display_name,
                300,
              )
            : null),
      },
      destinations: [
        {
          kind: 'channel',
          id: channel,
          address: null,
          displayName: null,
        },
      ],
      subject: null,
      text: text ?? null,
      html: null,
      attachments: files.value,
      occurredAt:
        slackTimestampMs(timestamp) ??
        epochSecondsMs(wrapper.event_time) ??
        null,
    },
  }
}

function normalizeHeaders(
  value: unknown,
):
  | { ok: true; value: Record<string, string> }
  | {
      ok: false
      code: 'invalid_payload'
      message: string
    } {
  if (value === undefined) return { ok: true, value: {} }
  if (!isRecord(value) || Object.keys(value).length > MAX_HEADERS) {
    return invalidPayload('Email headers must be a bounded string record')
  }
  const headers: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (
      key.length === 0 ||
      key.length > 200 ||
      typeof entry !== 'string' ||
      entry.length > 4_000
    ) {
      return invalidPayload('Email headers must be a bounded string record')
    }
    headers[key.toLowerCase()] = entry
  }
  return { ok: true, value: headers }
}

function normalizeEmailAttachments(
  value: unknown,
):
  | { ok: true; value: ConversationAttachment[] }
  | {
      ok: false
      code: 'invalid_payload'
      message: string
    } {
  if (value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    return invalidPayload('Email attachments exceed the supported limit')
  }
  const attachments: ConversationAttachment[] = []
  for (const entry of value) {
    if (!isRecord(entry)) {
      return invalidPayload('Email attachment must be an object')
    }
    const name = optionalString(entry.filename, 240)
    const contentType = optionalString(entry.contentType, 200)
    const contentBase64 = optionalString(
      entry.contentBase64,
      MAX_INLINE_ATTACHMENT_LENGTH,
    )
    const url = optionalString(entry.url, 2_048)
    const size = optionalFiniteNumber(entry.size, 0, MAX_ATTACHMENT_SIZE, true)
    if (
      name === undefined ||
      contentType === undefined ||
      contentBase64 === undefined ||
      url === undefined ||
      size === undefined
    ) {
      return invalidPayload('Email attachment contains an invalid field')
    }
    attachments.push({
      id: null,
      name: name ?? null,
      contentType: contentType ?? null,
      size: size ?? null,
      contentBase64: contentBase64 ?? null,
      url: url ?? null,
    })
  }
  return { ok: true, value: attachments }
}

function normalizeSlackFiles(
  value: unknown,
):
  | { ok: true; value: ConversationAttachment[] }
  | {
      ok: false
      code: 'invalid_payload'
      message: string
    } {
  if (value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    return invalidPayload('Slack files exceed the supported limit')
  }
  const files: ConversationAttachment[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return invalidPayload('Slack file must be an object')
    const size = optionalFiniteNumber(entry.size, 0, MAX_ATTACHMENT_SIZE, true)
    if (size === undefined) return invalidPayload('Slack file size is invalid')
    files.push({
      id: normalizeNullableString(entry.id, 300),
      name:
        normalizeNullableString(entry.name, 240) ??
        normalizeNullableString(entry.title, 240),
      contentType: normalizeNullableString(entry.mimetype, 200),
      size: size ?? null,
      contentBase64: null,
      // Slack file URLs require the workspace bot token. Products use the
      // `slack.download_file` Hub action with this file id; exposing a private
      // URL here would make downstream runtimes attempt an unauthenticated fetch.
      url: null,
    })
  }
  return { ok: true, value: files }
}

function normalizeTeamsAttachments(
  value: unknown,
):
  | { ok: true; value: ConversationAttachment[] }
  | {
      ok: false
      code: 'invalid_payload'
      message: string
    } {
  if (value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    return invalidPayload('Teams attachments exceed the supported limit')
  }
  const attachments: ConversationAttachment[] = []
  for (const entry of value) {
    if (!isRecord(entry)) {
      return invalidPayload('Teams attachment must be an object')
    }
    const id = optionalString(entry.id, 300)
    const name = optionalString(entry.name, 240)
    const contentType = optionalString(entry.contentType, 200)
    if (
      id === undefined ||
      name === undefined ||
      contentType === undefined
    ) {
      return invalidPayload('Teams attachment contains an invalid field')
    }
    attachments.push({
      id: normalizeNullableString(id, 300),
      name: normalizeNullableString(name, 240),
      contentType: normalizeNullableString(contentType, 200),
      size: null,
      contentBase64: null,
      // Bot attachment URLs require Microsoft authorization. The receiver
      // keeps that credential inside Hub; products only receive stable metadata.
      url: null,
    })
  }
  return { ok: true, value: attachments }
}

function normalizeTeamsTimestamp(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > 100) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp >= 0
    ? timestamp
    : undefined
}

function referencedMessageIds(headers: Record<string, string>): string[] {
  const values = [headers['in-reply-to'], headers.references].filter(
    (value): value is string => Boolean(value?.trim()),
  )
  const ids: string[] = []
  for (const value of values) {
    const bracketed = value.match(/<[^<>]{1,1000}>/g)
    const candidates = bracketed ?? value.split(/\s+/)
    for (const candidate of candidates) {
      const normalized = normalizeMessageId(candidate)
      if (normalized && !ids.includes(normalized)) ids.push(normalized)
    }
  }
  return ids.slice(0, 50)
}

function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.startsWith('<') && trimmed.endsWith('>')
    ? trimmed.slice(1, -1).trim() || null
    : trimmed
}

function normalizeMailbox(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeNullableString(
  value: unknown,
  maxLength: number,
): string | null {
  return typeof value === 'string' && value.length <= maxLength
    ? value.trim() || null
    : null
}

/**
 * Undefined means invalid; null means the optional field was absent.
 */
function optionalString(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) return null
  return typeof value === 'string' && value.length <= maxLength
    ? value
    : undefined
}

/**
 * Undefined means invalid; null means the optional field was absent.
 */
function optionalFiniteNumber(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
  integer = false,
): number | null | undefined {
  if (value === undefined) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    return undefined
  }
  return value
}

function slackTimestampMs(value: string | null): number | null {
  if (!value || !/^\d{1,12}(?:\.\d{1,9})?$/.test(value)) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.round(seconds * 1_000) : null
}

function epochSecondsMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1_000)
    : null
}

function unsupportedEvent(
  provider: string,
  type: string,
): ConversationEventNormalizationResult {
  return {
    ok: false,
    code: 'unsupported_event',
    message: `Conversation events do not support ${provider} event ${type}`,
  }
}

function invalidPayload(
  message: string,
): {
  ok: false
  code: 'invalid_payload'
  message: string
} {
  return { ok: false, code: 'invalid_payload', message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
