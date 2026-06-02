/**
 * Telegram Bot API connector — bot-token outbound messaging, inbound
 * polling/webhook setup, and chat/member introspection.
 *
 * Auth shape
 * ----------
 * Telegram bots authenticate by embedding the bot token directly in the
 * request URL path: `https://api.telegram.org/bot{TOKEN}/{method}`. There
 * is no OAuth2 endpoint (the "Telegram Login Widget" is a separate
 * HMAC-signed user-identity primitive, not an API access grant). Bots are
 * issued out-of-band by BotFather; the token IS the credential. We model
 * this as `api-key` with the raw bot token in `credentials.apiKey`. The
 * declarative-REST helper can't express URL-path credential placement, so
 * this adapter is hand-rolled, matching the twilio-sms pattern.
 *
 * Consistency model
 * -----------------
 * Telegram messages are append-only and advisory — no etag, no compare-
 * and-swap on sendMessage. Edits and deletes use the (chat_id, message_id)
 * pair as a natural idempotency anchor. We mark `advisory` so the planner
 * does not promise transactional outcomes; sendMessage CAS is `none`,
 * edits use `optimistic-read-verify`, and deletes / answerCallbackQuery /
 * setWebhook use `native-idempotency` since replaying the same call is
 * safe (same args ⇒ same end state).
 *
 * Capability surface (Bot API v7+)
 * --------------------------------
 *   reads       — getMe, getChat, getChatAdministrators, getChatMember,
 *                 getChatMemberCount, getUpdates, getFile, getWebhookInfo
 *   mutations   — sendMessage, sendPhoto, sendDocument, editMessageText,
 *                 deleteMessage, forwardMessage, answerCallbackQuery,
 *                 setWebhook, deleteWebhook
 *
 * Long-polling (`getUpdates`) and webhook receivers are both supported as
 * read/mutation capabilities; full inbound `handleInboundEvent` wiring is
 * left for the webhook layer to add once a `telegram-webhook-receiver`
 * adapter lands (Telegram delivers updates as raw POST bodies with a
 * `X-Telegram-Bot-Api-Secret-Token` header that the receiver verifies).
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  CredentialsExpired,
} from '../types.js'

const API_ROOT = 'https://api.telegram.org'
const FILE_ROOT = 'https://api.telegram.org/file'

export const telegramConnector: ConnectorAdapter = {
  manifest: {
    kind: 'telegram',
    displayName: 'Telegram',
    description:
      'Send messages, photos, and documents via a Telegram bot; read chat metadata and members; poll updates or register a webhook.',
    auth: {
      kind: 'api-key',
      hint: 'Paste the bot token issued by @BotFather (format: "123456789:AAExxxxx..."). The token IS the credential — Telegram has no OAuth grant.',
    },
    category: 'comms',
    defaultConsistencyModel: 'advisory',
    rateLimit: {
      // Telegram's documented per-bot global ceiling is ~30 messages/sec
      // across all chats. We meter under that so a chatty agent cannot
      // burn the bot's quota shared with other DataSources.
      requests: 25,
      windowMs: 1_000,
      scope: 'oauth-client',
    },
    capabilities: [
      {
        name: 'getMe',
        class: 'read',
        description: 'Return the bot identity (id, username, is_bot, name, supports_inline_queries).',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'getChat',
        class: 'read',
        description: 'Read a chat (group, supergroup, channel, or private) by id or @username.',
        parameters: {
          type: 'object',
          properties: {
            chat_id: {
              type: ['string', 'integer'],
              description: 'Numeric chat id or @channel_username.',
            },
          },
          required: ['chat_id'],
        },
      },
      {
        name: 'getChatAdministrators',
        class: 'read',
        description: 'List administrators of a chat (excludes regular members).',
        parameters: {
          type: 'object',
          properties: { chat_id: { type: ['string', 'integer'] } },
          required: ['chat_id'],
        },
      },
      {
        name: 'getChatMember',
        class: 'read',
        description: 'Read a single chat member (status, permissions, role).',
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            user_id: { type: 'integer' },
          },
          required: ['chat_id', 'user_id'],
        },
      },
      {
        name: 'getChatMemberCount',
        class: 'read',
        description: 'Return the total number of members in a chat.',
        parameters: {
          type: 'object',
          properties: { chat_id: { type: ['string', 'integer'] } },
          required: ['chat_id'],
        },
      },
      {
        name: 'getUpdates',
        class: 'read',
        description:
          'Long-poll for incoming updates. Mutually exclusive with setWebhook — calling getUpdates while a webhook is set returns 409.',
        parameters: {
          type: 'object',
          properties: {
            offset: { type: 'integer', description: 'Update id to acknowledge; returns updates > offset.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
            timeout: { type: 'integer', minimum: 0, maximum: 50, description: 'Long-poll seconds (0 = short poll).' },
            allowed_updates: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter (e.g. ["message", "callback_query"]); empty = all except chat_member.',
            },
          },
        },
      },
      {
        name: 'getFile',
        class: 'read',
        description:
          'Resolve a file_id to a downloadable path. The response includes `file_path`; download URL is `https://api.telegram.org/file/bot<token>/<file_path>`.',
        parameters: {
          type: 'object',
          properties: { file_id: { type: 'string' } },
          required: ['file_id'],
        },
      },
      {
        name: 'getWebhookInfo',
        class: 'read',
        description: 'Inspect the currently registered webhook (url, pending_update_count, last_error_message).',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'sendMessage',
        class: 'mutation',
        description:
          'Send a text message to a chat. Append-only — no upstream dedup — the caller owns idempotency via the SDK idempotencyKey.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            text: { type: 'string', description: 'Message body (≤4096 chars).' },
            parse_mode: { type: 'string', enum: ['MarkdownV2', 'HTML', 'Markdown'] },
            entities: { type: 'array', items: { type: 'object' } },
            link_preview_options: { type: 'object' },
            disable_notification: { type: 'boolean' },
            protect_content: { type: 'boolean' },
            reply_parameters: { type: 'object', description: 'Reply target spec.' },
            reply_markup: { type: 'object', description: 'Inline keyboard / reply keyboard markup.' },
            message_thread_id: { type: 'integer', description: 'Forum topic / thread id.' },
          },
          required: ['chat_id', 'text'],
        },
      },
      {
        name: 'sendPhoto',
        class: 'mutation',
        description:
          'Send a photo to a chat by URL or pre-uploaded file_id. Append-only — no upstream dedup.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            photo: { type: 'string', description: 'HTTPS URL or Telegram file_id.' },
            caption: { type: 'string' },
            parse_mode: { type: 'string', enum: ['MarkdownV2', 'HTML', 'Markdown'] },
            has_spoiler: { type: 'boolean' },
            disable_notification: { type: 'boolean' },
            reply_parameters: { type: 'object' },
            reply_markup: { type: 'object' },
            message_thread_id: { type: 'integer' },
          },
          required: ['chat_id', 'photo'],
        },
      },
      {
        name: 'sendDocument',
        class: 'mutation',
        description: 'Send a document (file) to a chat by URL or pre-uploaded file_id. Append-only.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            document: { type: 'string', description: 'HTTPS URL or Telegram file_id.' },
            caption: { type: 'string' },
            parse_mode: { type: 'string', enum: ['MarkdownV2', 'HTML', 'Markdown'] },
            disable_notification: { type: 'boolean' },
            reply_parameters: { type: 'object' },
            reply_markup: { type: 'object' },
            message_thread_id: { type: 'integer' },
          },
          required: ['chat_id', 'document'],
        },
      },
      {
        name: 'forwardMessage',
        class: 'mutation',
        description: 'Forward a message between chats. Append-only — replays create new forwards.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'], description: 'Destination chat.' },
            from_chat_id: { type: ['string', 'integer'], description: 'Origin chat of the source message.' },
            message_id: { type: 'integer' },
            disable_notification: { type: 'boolean' },
            protect_content: { type: 'boolean' },
            message_thread_id: { type: 'integer' },
          },
          required: ['chat_id', 'from_chat_id', 'message_id'],
        },
      },
      {
        name: 'editMessageText',
        class: 'mutation',
        description:
          'Edit an existing bot-authored message. Idempotent on (chat_id, message_id) but the caller should read-verify before retrying lossy edits.',
        cas: 'optimistic-read-verify',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            message_id: { type: 'integer' },
            inline_message_id: { type: 'string', description: 'Use instead of (chat_id, message_id) for inline-mode messages.' },
            text: { type: 'string' },
            parse_mode: { type: 'string', enum: ['MarkdownV2', 'HTML', 'Markdown'] },
            entities: { type: 'array', items: { type: 'object' } },
            link_preview_options: { type: 'object' },
            reply_markup: { type: 'object' },
          },
          required: ['text'],
        },
      },
      {
        name: 'deleteMessage',
        class: 'mutation',
        description: 'Delete a message. Idempotent on (chat_id, message_id) — re-deleting returns ok:true semantics.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            message_id: { type: 'integer' },
          },
          required: ['chat_id', 'message_id'],
        },
      },
      {
        name: 'answerCallbackQuery',
        class: 'mutation',
        description:
          'Acknowledge an inline-keyboard callback. Idempotent on callback_query_id — Telegram only accepts the first answer.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            callback_query_id: { type: 'string' },
            text: { type: 'string', description: '≤200 char notification body shown to the user.' },
            show_alert: { type: 'boolean' },
            url: { type: 'string' },
            cache_time: { type: 'integer' },
          },
          required: ['callback_query_id'],
        },
      },
      {
        name: 'setWebhook',
        class: 'mutation',
        description:
          'Register an HTTPS webhook for incoming updates. Idempotent on the (url, secret_token) tuple — re-setting the same URL is a no-op.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'HTTPS endpoint (no self-signed certs unless certificate is provided).' },
            secret_token: {
              type: 'string',
              description:
                '1-256 char shared secret echoed in `X-Telegram-Bot-Api-Secret-Token` header for verification.',
            },
            max_connections: { type: 'integer', minimum: 1, maximum: 100, default: 40 },
            allowed_updates: { type: 'array', items: { type: 'string' } },
            drop_pending_updates: { type: 'boolean' },
            ip_address: { type: 'string' },
          },
          required: ['url'],
        },
      },
      {
        name: 'deleteWebhook',
        class: 'mutation',
        description: 'Remove the registered webhook so getUpdates becomes usable again. Idempotent.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            drop_pending_updates: { type: 'boolean' },
          },
        },
      },
      {
        name: 'editMessageMedia',
        class: 'mutation',
        description:
          'Replace media (photo / video / animation / audio / document) on a previously-sent message. Idempotent on (chat_id, message_id) — re-sending the same media is a no-op upstream.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            message_id: { type: 'integer' },
            inline_message_id: { type: 'string', description: 'Use instead of (chat_id, message_id) for inline-mode messages.' },
            media: {
              type: 'object',
              description:
                'InputMedia object — { type: photo|video|animation|audio|document, media: <url|file_id>, caption?, parse_mode?, ... }.',
            },
            reply_markup: { type: 'object' },
          },
          required: ['media'],
        },
      },
      {
        name: 'pinChatMessage',
        class: 'mutation',
        description:
          'Pin a message in a chat. Idempotent on (chat_id, message_id) — pinning an already-pinned message is a no-op upstream.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            message_id: { type: 'integer' },
            disable_notification: { type: 'boolean' },
            business_connection_id: { type: 'string' },
          },
          required: ['chat_id', 'message_id'],
        },
      },
      {
        name: 'unpinChatMessage',
        class: 'mutation',
        description:
          'Unpin a message in a chat. Omit message_id to unpin the most-recently-pinned. Idempotent — unpinning an already-unpinned message is a no-op.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            message_id: { type: 'integer', description: 'Optional — when omitted, unpins the most-recently-pinned.' },
            business_connection_id: { type: 'string' },
          },
          required: ['chat_id'],
        },
      },
      {
        name: 'banChatMember',
        class: 'mutation',
        description:
          'Ban a user from a group / supergroup / channel. Idempotent on (chat_id, user_id) — re-banning an already-banned user is a no-op.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            user_id: { type: 'integer' },
            until_date: { type: 'integer', description: 'Unix time when the ban lifts; 0 or omitted = permanent.' },
            revoke_messages: { type: 'boolean', description: 'Delete all messages from the user.' },
          },
          required: ['chat_id', 'user_id'],
        },
      },
      {
        name: 'restrictChatMember',
        class: 'mutation',
        description:
          'Restrict a user\'s permissions in a supergroup. Body carries the full ChatPermissions object — every setting must be present, omitted booleans are treated as false. Idempotent on (chat_id, user_id, permissions).',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            chat_id: { type: ['string', 'integer'] },
            user_id: { type: 'integer' },
            permissions: {
              type: 'object',
              description: 'ChatPermissions object — { can_send_messages, can_send_audios, can_send_documents, ... }.',
            },
            use_independent_chat_permissions: { type: 'boolean' },
            until_date: { type: 'integer', description: 'Unix time when restrictions lift; 0 or omitted = permanent.' },
          },
          required: ['chat_id', 'user_id', 'permissions'],
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const data = await callMethod(inv, inv.capabilityName)
    return { data, fetchedAt: Date.now() }
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const data = await callMethod(inv, inv.capabilityName)
    return {
      status: 'committed',
      data,
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test(source) {
    try {
      const token = extractToken(source.credentials)
      const res = await fetch(`${API_ROOT}/bot${encodeURIComponent(token)}/getMe`, {
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401) {
        return { ok: false, reason: 'Telegram rejected credentials (401) — bot token invalid or revoked' }
      }
      if (!res.ok) {
        return { ok: false, reason: `Telegram returned ${res.status}` }
      }
      const json = (await res.json()) as TelegramResponse<{ id: number; username?: string }>
      if (!json.ok) {
        return { ok: false, reason: json.description ?? 'Telegram returned ok:false' }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },

}

/** Public file-download root. Callers that resolve `getFile` results into
 *  download URLs build `${TELEGRAM_FILE_DOWNLOAD_ROOT}/bot<token>/<file_path>`;
 *  exposed here so consumers don't reinvent the constant. */
export const TELEGRAM_FILE_DOWNLOAD_ROOT = FILE_ROOT

interface TelegramResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { migrate_to_chat_id?: number; retry_after?: number }
}

async function callMethod(inv: ConnectorInvocation, method: string): Promise<unknown> {
  const token = extractToken(inv.source.credentials)
  const url = `${API_ROOT}/bot${encodeURIComponent(token)}/${method}`
  const body = pruneUndefined(inv.args)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired(`Telegram rejected credentials (401) on ${method}`, inv.source.id)
  }
  const text = await res.text()
  const json = text ? (JSON.parse(text) as TelegramResponse<unknown>) : { ok: false, description: 'empty body' }
  if (res.status === 429 || json.error_code === 429) {
    const retryAfter = json.parameters?.retry_after
    throw new Error(
      `telegram ${method} rate-limited${retryAfter !== undefined ? ` (retry_after=${retryAfter}s)` : ''}`,
    )
  }
  if (res.status === 403 && /bot was blocked|chat not found|user is deactivated/i.test(json.description ?? '')) {
    // Recipient-side terminal failure; surface as data so the agent can
    // route around it rather than throwing. The mutation still committed
    // from the SDK's perspective — we just couldn't reach the chat.
    return {
      ok: false,
      delivered: false,
      reason: json.description,
      error_code: json.error_code,
    }
  }
  if (!res.ok || !json.ok) {
    throw new Error(
      `telegram ${method} ${res.status}: ${(json.description ?? text).slice(0, 300)}`,
    )
  }
  return json.result ?? null
}

function extractToken(credentials: { kind: string; apiKey?: string }): string {
  if (credentials.kind !== 'api-key' || typeof credentials.apiKey !== 'string' || !credentials.apiKey.trim()) {
    throw new Error('telegram: expected api-key credentials with the bot token as apiKey')
  }
  const token = credentials.apiKey.trim()
  // Bot tokens are "<bot_id>:<hash>", e.g. "123456789:AAExxxxx".
  // Reject obviously malformed inputs early so a typo doesn't reach the
  // Telegram API as a 401 we'd then surface as "credentials expired".
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('telegram: bot token must look like "<digits>:<hash>" (issued by @BotFather)')
  }
  return token
}

function pruneUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value
  }
  return out
}
