/**
 * Slack connector — bot-token OAuth, three messaging-oriented capabilities.
 *
 *   post_message(channel, text|blocks)  → mutation; cas: 'none'
 *   lookup_user(email)                  → read
 *   list_channels(types?, limit?)       → read
 *
 * Why `cas: 'none'` is acceptable here (and only here in this batch):
 * Slack messages are advisory — we set
 * `defaultConsistencyModel: 'advisory'`. The registry validator allows
 * `cas: 'none'` only on non-authoritative connectors precisely so that
 * append-only messaging surfaces don't have to invent fake CAS theatre.
 * The agent's planner already treats `advisory` data as informational
 * and does not promise outcomes based on its post results without
 * a separate authoritative confirm. MutationGuard's idempotency-key
 * dedup remains in force above the connector — a retry of the same
 * post_message call will short-circuit before reaching Slack.
 *
 * Auth: standard OAuth2. Slack's `/oauth.v2.access` returns a bot
 * `access_token` (`xoxb-…`) but does NOT return a refresh_token unless
 * the app has rotated tokens enabled. Bot tokens are long-lived by
 * default; we surface refreshToken handling but treat its absence as
 * normal rather than an error.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type ConnectorCredentials,
  CredentialsExpired,
} from '../types.js'
import { exchangeAuthorizationCode, refreshAccessToken } from '../oauth.js'

const SCOPE_CHAT_WRITE = 'chat:write'
const SCOPE_USERS_READ = 'users:read'
const SCOPE_USERS_READ_EMAIL = 'users:read.email'
const SCOPE_CHANNELS_READ = 'channels:read'
const SCOPE_REACTIONS_WRITE = 'reactions:write'
const SCOPE_FILES_WRITE = 'files:write'

const SCOPES = [
  SCOPE_CHAT_WRITE,
  SCOPE_USERS_READ,
  SCOPE_USERS_READ_EMAIL,
  SCOPE_CHANNELS_READ,
  SCOPE_REACTIONS_WRITE,
  SCOPE_FILES_WRITE,
]
const AUTH_URL = 'https://slack.com/oauth/v2/authorize'
const TOKEN_URL = 'https://slack.com/api/oauth.v2.access'
const API = 'https://slack.com/api'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface SlackOptions {
  clientId: string
  clientSecret: string
}

export function slack(opts: SlackOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const adapter: ConnectorAdapter = {
  manifest: {
    // The inbound Events API receiver registers kind `slack-inbound`
    // (hmac signing-secret auth). This connector — kind `slack` —
    // carries the OAuth bot-token outbound surface. Two kinds, one
    // logical product, deliberately split because the credential shapes
    // are different (HMAC secret vs bot OAuth) and operators commonly
    // wire one without the other.
    kind: 'slack',
    displayName: 'Slack',
    description:
      "Post messages from the agent into Slack, look up users by email, and list channels. Advisory surface — Slack posts are informational, not transactional.",
    auth: {
      kind: 'oauth2',
      authorizationUrl: AUTH_URL,
      tokenUrl: TOKEN_URL,
      scopes: SCOPES,
      clientIdEnv: 'SLACK_OAUTH_CLIENT_ID',
      clientSecretEnv: 'SLACK_OAUTH_CLIENT_SECRET',
    },
    category: 'comms',
    defaultConsistencyModel: 'advisory',
    capabilities: [
      {
        name: 'post_message',
        class: 'mutation',
        description: 'Post a message from the bot to a channel or user DM. Append-only — no CAS.',
        cas: 'none',
        externalEffect: true,
        requiredScopes: [SCOPE_CHAT_WRITE],
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id (C…) or user id (U…) for DM.' },
            text: { type: 'string' },
            blocks: { type: 'array', description: 'Optional Slack Block Kit blocks.' },
          },
          required: ['channel'],
        },
      },
      {
        name: 'post_in_thread',
        class: 'mutation',
        description:
          'Post a message into an existing thread. Same as post_message but `thread_ts` is required so the message is threaded under the parent message rather than posted top-level.',
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_CHAT_WRITE],
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id where the parent message lives.' },
            thread_ts: { type: 'string', description: 'Parent message ts (e.g. "1700000000.000200").' },
            text: { type: 'string' },
            blocks: { type: 'array', description: 'Optional Slack Block Kit blocks.' },
          },
          required: ['channel', 'thread_ts'],
        },
      },
      {
        name: 'update_message',
        class: 'mutation',
        description: 'Edit a previously-posted message identified by (channel, ts). Provide `text` or `blocks`.',
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_CHAT_WRITE],
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            ts: { type: 'string', description: 'ts of the message to update.' },
            text: { type: 'string' },
            blocks: { type: 'array', description: 'Optional Slack Block Kit blocks.' },
          },
          required: ['channel', 'ts'],
        },
      },
      {
        name: 'delete_message',
        class: 'mutation',
        description: 'Delete a message identified by (channel, ts).',
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_CHAT_WRITE],
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            ts: { type: 'string', description: 'ts of the message to delete.' },
          },
          required: ['channel', 'ts'],
        },
      },
      {
        name: 'add_reaction',
        class: 'mutation',
        description: 'Add an emoji reaction to a message. `name` is the emoji name without colons (e.g. "thumbsup").',
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_REACTIONS_WRITE],
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            timestamp: { type: 'string', description: 'ts of the target message.' },
            name: { type: 'string', description: 'Emoji name without surrounding colons.' },
          },
          required: ['channel', 'timestamp', 'name'],
        },
      },
      {
        name: 'upload_file',
        class: 'mutation',
        description:
          "Upload a file to one or more channels via Slack's v2 two-step external-upload flow (files.getUploadURLExternal → PUT to returned URL → files.completeUploadExternal). `content` is base64-encoded bytes.",
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_FILES_WRITE],
        parameters: {
          type: 'object',
          properties: {
            channels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Channel ids to share the uploaded file into.',
            },
            filename: { type: 'string' },
            content: { type: 'string', description: 'Base64-encoded file bytes.' },
            title: { type: 'string' },
            initial_comment: { type: 'string', description: 'Optional message posted alongside the file.' },
          },
          required: ['channels', 'filename', 'content'],
        },
      },
      {
        name: 'lookup_user',
        class: 'read',
        description: 'Look up a Slack workspace user by email.',
        parameters: {
          type: 'object',
          properties: { email: { type: 'string' } },
          required: ['email'],
        },
      },
      {
        name: 'list_channels',
        class: 'read',
        description: 'List channels visible to the bot. `types` defaults to public_channel,private_channel.',
        parameters: {
          type: 'object',
          properties: {
            types: { type: 'string', description: 'Comma-separated channel types.' },
            limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
          },
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const accessToken = readBotToken(inv.source.credentials)
    if (inv.capabilityName === 'lookup_user') {
      const { email } = inv.args as { email: string }
      const url = `${API}/users.lookupByEmail?email=${encodeURIComponent(email)}`
      const json = await slackGet(url, accessToken, inv.source.id)
      if (!json.ok) {
        if (json.error === 'users_not_found') {
          return { data: { found: false }, fetchedAt: Date.now() }
        }
        throw new Error(`slack lookup_user: ${json.error ?? 'unknown'}`)
      }
      const u = json.user as { id: string; name?: string; real_name?: string; profile?: unknown } | undefined
      return {
        data: { found: true, user: u ? { id: u.id, name: u.name, realName: u.real_name } : null },
        fetchedAt: Date.now(),
      }
    }
    if (inv.capabilityName === 'list_channels') {
      const { types, limit } = inv.args as { types?: string; limit?: number }
      const params = new URLSearchParams({
        limit: String(Math.min(Math.max(1, limit ?? 200), 1000)),
        types: types ?? 'public_channel,private_channel',
      })
      const json = await slackGet(`${API}/conversations.list?${params.toString()}`, accessToken, inv.source.id)
      if (!json.ok) {
        throw new Error(`slack list_channels: ${json.error ?? 'unknown'}`)
      }
      const channels = (json.channels as Array<{ id: string; name: string; is_private?: boolean }>) ?? []
      return {
        data: { channels: channels.map(c => ({ id: c.id, name: c.name, isPrivate: c.is_private ?? false })) },
        fetchedAt: Date.now(),
      }
    }
    throw new Error(`slack: unknown read capability ${inv.capabilityName}`)
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const accessToken = readBotToken(inv.source.credentials)
    if (inv.capabilityName === 'post_message') {
      return postMessage(inv, accessToken, 15_000)
    }
    if (inv.capabilityName === 'post_in_thread') {
      return postInThread(inv, accessToken, 15_000)
    }
    if (inv.capabilityName === 'update_message') {
      return updateMessage(inv, accessToken, 15_000)
    }
    if (inv.capabilityName === 'delete_message') {
      return deleteMessage(inv, accessToken, 15_000)
    }
    if (inv.capabilityName === 'add_reaction') {
      return addReaction(inv, accessToken, 15_000)
    }
    if (inv.capabilityName === 'upload_file') {
      return uploadFile(inv, accessToken, 30_000)
    }
    throw new Error(`slack: unknown mutation capability ${inv.capabilityName}`)
  },

  async exchangeOAuth(input) {
    if (!clientId || !clientSecret) {
      throw new Error('Slack OAuth client not configured (SLACK_OAUTH_CLIENT_ID / _SECRET)')
    }
    // Slack's oauth.v2.access response is non-standard: the bot token
    // lives at `access_token` inside the top-level response (NOT nested
    // — that's the v1 quirk). We use exchangeAuthorizationCode for the
    // POST mechanics, then re-tag the result.
    const tokens = await exchangeAuthorizationCode({
      tokenUrl: TOKEN_URL,
      clientId,
      clientSecret,
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
    })
    return {
      credentials: {
        kind: 'oauth2',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      },
      scopes: tokens.scope?.split(/[,\s]+/) ?? SCOPES,
      metadata: {},
    }
  },

  async refreshToken(creds) {
    if (creds.kind !== 'oauth2' || !creds.refreshToken) {
      // Slack bot tokens are long-lived without rotation; absence of
      // refresh_token is normal. Return creds unchanged so the caller
      // doesn't trigger a reconnect prematurely.
      return creds
    }
    const refreshed = await refreshAccessToken({
      tokenUrl: TOKEN_URL,
      clientId,
      clientSecret,
      refreshToken: creds.refreshToken,
    })
    return {
      kind: 'oauth2',
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? creds.refreshToken,
      expiresAt: refreshed.expiresIn ? Date.now() + refreshed.expiresIn * 1000 : undefined,
    }
  },

  async test(source) {
    try {
      const accessToken = readBotToken(source.credentials)
      const res = await fetch(`${API}/auth.test`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok) return { ok: false, reason: `Slack returned ${res.status}` }
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!json.ok) {
        return { ok: false, reason: `Slack auth.test: ${json.error ?? 'unknown'} — reconnect required` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
  }
  return adapter
}

function readBotToken(creds: ConnectorCredentials): string {
  if (creds.kind !== 'oauth2' || typeof creds.accessToken !== 'string') {
    throw new Error('slack: expected oauth2 credentials')
  }
  return creds.accessToken
}

interface SlackJsonResponse {
  ok?: boolean
  error?: string
  [k: string]: unknown
}

async function slackGet(url: string, accessToken: string, dataSourceId: string): Promise<SlackJsonResponse> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('Slack rejected token (401)', dataSourceId)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`slack HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  return (await res.json()) as SlackJsonResponse
}

/** Slack returns HTTP 200 with `{ok:false, error:"…"}` on logical errors.
 *  Centralize the auth-error → CredentialsExpired mapping so every mutation
 *  routes reconnect prompts the same way. */
function isAuthError(error: string | undefined): boolean {
  return (
    error === 'invalid_auth' ||
    error === 'token_expired' ||
    error === 'not_authed' ||
    error === 'token_revoked'
  )
}

async function slackPostJson(
  url: string,
  accessToken: string,
  body: unknown,
  timeoutMs: number,
  dataSourceId: string,
  cap: string,
): Promise<SlackJsonResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Slack rejected token (${res.status})`, dataSourceId)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`slack ${cap} ${res.status}: ${t.slice(0, 200)}`)
  }
  const json = (await res.json()) as SlackJsonResponse
  if (!json.ok) {
    if (isAuthError(json.error)) {
      throw new CredentialsExpired(`Slack rejected token: ${json.error}`, dataSourceId)
    }
    throw new Error(`slack ${cap}: ${json.error ?? 'unknown'}`)
  }
  return json
}

async function postMessage(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { channel, text, blocks } = inv.args as {
    channel?: string
    text?: string
    blocks?: unknown[]
  }
  if (!channel) throw new Error('slack post_message: `channel` is required')
  const json = await slackPostJson(
    `${API}/chat.postMessage`,
    accessToken,
    { channel, text, blocks },
    timeoutMs,
    inv.source.id,
    'post_message',
  )
  return {
    status: 'committed',
    data: { ts: json.ts, channel: json.channel },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function postInThread(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { channel, thread_ts, text, blocks } = inv.args as {
    channel?: string
    thread_ts?: string
    text?: string
    blocks?: unknown[]
  }
  if (!channel) throw new Error('slack post_in_thread: `channel` is required')
  if (!thread_ts) throw new Error('slack post_in_thread: `thread_ts` is required')
  const json = await slackPostJson(
    `${API}/chat.postMessage`,
    accessToken,
    { channel, thread_ts, text, blocks },
    timeoutMs,
    inv.source.id,
    'post_in_thread',
  )
  return {
    status: 'committed',
    data: { ts: json.ts, channel: json.channel, thread_ts },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function updateMessage(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { channel, ts, text, blocks } = inv.args as {
    channel?: string
    ts?: string
    text?: string
    blocks?: unknown[]
  }
  if (!channel) throw new Error('slack update_message: `channel` is required')
  if (!ts) throw new Error('slack update_message: `ts` is required')
  if (text === undefined && blocks === undefined) {
    throw new Error('slack update_message: `text` or `blocks` is required')
  }
  const json = await slackPostJson(
    `${API}/chat.update`,
    accessToken,
    { channel, ts, text, blocks },
    timeoutMs,
    inv.source.id,
    'update_message',
  )
  return {
    status: 'committed',
    data: { ts: json.ts, channel: json.channel, text: json.text },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function deleteMessage(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { channel, ts } = inv.args as { channel?: string; ts?: string }
  if (!channel) throw new Error('slack delete_message: `channel` is required')
  if (!ts) throw new Error('slack delete_message: `ts` is required')
  const json = await slackPostJson(
    `${API}/chat.delete`,
    accessToken,
    { channel, ts },
    timeoutMs,
    inv.source.id,
    'delete_message',
  )
  return {
    status: 'committed',
    data: { ts: json.ts ?? ts, channel: json.channel ?? channel },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function addReaction(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { channel, timestamp, name } = inv.args as {
    channel?: string
    timestamp?: string
    name?: string
  }
  if (!channel) throw new Error('slack add_reaction: `channel` is required')
  if (!timestamp) throw new Error('slack add_reaction: `timestamp` is required')
  if (!name) throw new Error('slack add_reaction: `name` is required')
  // Slack treats a repeat reaction from the same user as `already_reacted`.
  // Surface that as an idempotent replay so MutationGuard retries don't
  // look like failures.
  const res = await fetch(`${API}/reactions.add`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, timestamp, name }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Slack rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`slack add_reaction ${res.status}: ${t.slice(0, 200)}`)
  }
  const json = (await res.json()) as SlackJsonResponse
  if (!json.ok) {
    if (json.error === 'already_reacted') {
      return {
        status: 'committed',
        data: { channel, timestamp, name },
        committedAt: Date.now(),
        idempotentReplay: true,
      }
    }
    if (isAuthError(json.error)) {
      throw new CredentialsExpired(`Slack rejected token: ${json.error}`, inv.source.id)
    }
    throw new Error(`slack add_reaction: ${json.error ?? 'unknown'}`)
  }
  return {
    status: 'committed',
    data: { channel, timestamp, name },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function uploadFile(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = inv.args as {
    channels?: string[]
    filename?: string
    content?: string
    title?: string
    initial_comment?: string
  }
  if (!Array.isArray(args.channels) || args.channels.length === 0) {
    throw new Error('slack upload_file: `channels` is required (non-empty array)')
  }
  if (!args.filename) throw new Error('slack upload_file: `filename` is required')
  if (!args.content) throw new Error('slack upload_file: `content` is required')

  const bytes = Buffer.from(args.content, 'base64')

  // Step 1 — reserve an upload URL.
  const stepOne = await fetch(`${API}/files.getUploadURLExternal`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ filename: args.filename, length: bytes.byteLength }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (stepOne.status === 401 || stepOne.status === 403) {
    throw new CredentialsExpired(`Slack rejected token (${stepOne.status})`, inv.source.id)
  }
  if (!stepOne.ok) {
    const t = await stepOne.text().catch(() => '')
    throw new Error(`slack upload_file getUploadURLExternal ${stepOne.status}: ${t.slice(0, 200)}`)
  }
  const reservation = (await stepOne.json()) as SlackJsonResponse & {
    upload_url?: string
    file_id?: string
  }
  if (!reservation.ok) {
    if (isAuthError(reservation.error)) {
      throw new CredentialsExpired(`Slack rejected token: ${reservation.error}`, inv.source.id)
    }
    throw new Error(`slack upload_file getUploadURLExternal: ${reservation.error ?? 'unknown'}`)
  }
  if (!reservation.upload_url || !reservation.file_id) {
    throw new Error('slack upload_file: getUploadURLExternal missing upload_url/file_id')
  }

  // Step 2 — push the raw bytes to the issued URL.
  const stepTwo = await fetch(reservation.upload_url, {
    method: 'POST',
    body: bytes,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!stepTwo.ok) {
    const t = await stepTwo.text().catch(() => '')
    throw new Error(`slack upload_file upload_url ${stepTwo.status}: ${t.slice(0, 200)}`)
  }

  // Step 3 — finalize and share into the target channels.
  const completePayload: Record<string, unknown> = {
    files: [{ id: reservation.file_id, title: args.title ?? args.filename }],
    channel_id: args.channels.join(','),
  }
  if (args.initial_comment) completePayload.initial_comment = args.initial_comment

  const completeRes = await slackPostJson(
    `${API}/files.completeUploadExternal`,
    accessToken,
    completePayload,
    timeoutMs,
    inv.source.id,
    'upload_file',
  )
  const files = (completeRes.files as Array<{ id: string; title?: string; permalink?: string }>) ?? []
  return {
    status: 'committed',
    data: {
      fileId: reservation.file_id,
      channels: args.channels,
      files: files.map(f => ({ id: f.id, title: f.title, permalink: f.permalink })),
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}
