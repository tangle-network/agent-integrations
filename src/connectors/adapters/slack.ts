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

const SCOPES = ['chat:write', 'users:read', 'users:read.email', 'channels:read']
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
    if (inv.capabilityName !== 'post_message') {
      throw new Error(`slack: unknown mutation capability ${inv.capabilityName}`)
    }
    const accessToken = readBotToken(inv.source.credentials)
    const { channel, text, blocks } = inv.args as {
      channel: string
      text?: string
      blocks?: unknown[]
    }
    const res = await fetch(`${API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text, blocks }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 401) {
      throw new CredentialsExpired('Slack rejected token (401)', inv.source.id)
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`slack post_message HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    // Slack returns 200 with `ok:false` on logical errors. Map common
    // auth/scope failures back to CredentialsExpired so the UI can prompt
    // a reconnect.
    const json = (await res.json()) as {
      ok?: boolean
      error?: string
      ts?: string
      channel?: string
    }
    if (!json.ok) {
      if (
        json.error === 'invalid_auth' ||
        json.error === 'token_expired' ||
        json.error === 'not_authed' ||
        json.error === 'token_revoked'
      ) {
        throw new CredentialsExpired(`Slack rejected token: ${json.error}`, inv.source.id)
      }
      throw new Error(`slack post_message: ${json.error ?? 'unknown'}`)
    }
    return {
      status: 'committed',
      data: { ts: json.ts, channel: json.channel },
      committedAt: Date.now(),
      idempotentReplay: false,
    }
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
