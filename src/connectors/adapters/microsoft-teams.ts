/**
 * Microsoft Teams connector — Graph-backed messaging surface.
 *
 *   post_channel_message(teamId, channelId, content[, contentType])  → mutation; cas: 'none'
 *   post_chat_message(chatId, content[, contentType])                → mutation; cas: 'none'
 *   list_channel_messages(teamId, channelId[, top])                  → read
 *   list_joined_teams()                                              → read
 *   list_team_channels(teamId)                                       → read
 *   lookup_user(email)                                               → read
 *
 * Conflict model mirrors slack: Teams chat is append-only and advisory —
 * Graph does not expose ETag-CAS on `chatMessage` posts, and there is no
 * server-side dedup analogue to Slack `client_msg_id`. We set
 * `defaultConsistencyModel: 'advisory'` and use `cas: 'none'` on the
 * mutation paths; the upstream `MutationGuard` short-circuits idempotency
 * by key before the Graph call runs.
 *
 * Auth: standard OAuth2 against the v2.0 endpoint. `offline_access` is
 * required to receive a refresh_token; without it the connection silently
 * dies after the access token's first hour. Channel-message scopes
 * (`ChannelMessage.Send`) are delegated permissions — the bot posts as
 * the connected user, NOT as an application identity. Application
 * messages would require a different grant flow (resource-specific
 * consent + bot framework registration), out of scope for this adapter.
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

const SCOPES = [
  'https://graph.microsoft.com/ChannelMessage.Send',
  'https://graph.microsoft.com/Chat.ReadWrite',
  'https://graph.microsoft.com/Team.ReadBasic.All',
  'https://graph.microsoft.com/Channel.ReadBasic.All',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/User.ReadBasic.All',
  // offline_access is required on v2.0 to receive a refresh_token.
  'offline_access',
]
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH = 'https://graph.microsoft.com/v1.0'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface MicrosoftTeamsOptions {
  clientId: string
  clientSecret: string
}

export function microsoftTeams(opts: MicrosoftTeamsOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'microsoft-teams',
      displayName: 'Microsoft Teams',
      description:
        "Post messages from the agent into Microsoft Teams channels and 1:1/group chats, list teams and channels, and look up users by email. Advisory surface — Teams posts are informational, not transactional.",
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes: SCOPES,
        clientIdEnv: 'MS_OAUTH_CLIENT_ID',
        clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
      },
      category: 'comms',
      defaultConsistencyModel: 'advisory',
      capabilities: [
        {
          name: 'post_channel_message',
          class: 'mutation',
          description:
            'Post a message to a Teams channel as the connected user. Append-only — no CAS.',
          cas: 'none',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              teamId: { type: 'string', description: 'Graph team id (group id).' },
              channelId: { type: 'string', description: 'Graph channel id.' },
              content: { type: 'string', description: 'Message body.' },
              contentType: {
                type: 'string',
                enum: ['text', 'html'],
                default: 'text',
                description: 'Body format — text or html.',
              },
            },
            required: ['teamId', 'channelId', 'content'],
          },
        },
        {
          name: 'post_chat_message',
          class: 'mutation',
          description:
            'Post a message to a 1:1 or group chat as the connected user. Append-only — no CAS.',
          cas: 'none',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              chatId: { type: 'string', description: 'Graph chat id (e.g. 19:meeting_… or 19:…@thread.v2).' },
              content: { type: 'string', description: 'Message body.' },
              contentType: {
                type: 'string',
                enum: ['text', 'html'],
                default: 'text',
                description: 'Body format — text or html.',
              },
            },
            required: ['chatId', 'content'],
          },
        },
        {
          name: 'list_channel_messages',
          class: 'read',
          description: 'List recent messages in a Teams channel (most recent first).',
          parameters: {
            type: 'object',
            properties: {
              teamId: { type: 'string' },
              channelId: { type: 'string' },
              top: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            },
            required: ['teamId', 'channelId'],
          },
        },
        {
          name: 'list_joined_teams',
          class: 'read',
          description: 'List teams the connected user has joined.',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'list_team_channels',
          class: 'read',
          description: 'List channels in a Team the connected user can see.',
          parameters: {
            type: 'object',
            properties: { teamId: { type: 'string' } },
            required: ['teamId'],
          },
        },
        {
          name: 'lookup_user',
          class: 'read',
          description: 'Look up a Microsoft 365 user by primary email (UPN or mail address).',
          parameters: {
            type: 'object',
            properties: { email: { type: 'string' } },
            required: ['email'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
      if (inv.capabilityName === 'list_joined_teams') {
        const json = await graphGet<{ value?: Array<{ id: string; displayName?: string; description?: string }> }>(
          `${GRAPH}/me/joinedTeams`,
          accessToken,
          inv.source.id,
        )
        const teams = (json.value ?? []).map((t) => ({
          id: t.id,
          displayName: t.displayName,
          description: t.description,
        }))
        return { data: { teams }, fetchedAt: Date.now() }
      }
      if (inv.capabilityName === 'list_team_channels') {
        const { teamId } = inv.args as { teamId: string }
        const json = await graphGet<{
          value?: Array<{ id: string; displayName?: string; membershipType?: string }>
        }>(`${GRAPH}/teams/${encodeURIComponent(teamId)}/channels`, accessToken, inv.source.id)
        const channels = (json.value ?? []).map((c) => ({
          id: c.id,
          displayName: c.displayName,
          membershipType: c.membershipType,
        }))
        return { data: { channels }, fetchedAt: Date.now() }
      }
      if (inv.capabilityName === 'list_channel_messages') {
        const { teamId, channelId, top } = inv.args as {
          teamId: string
          channelId: string
          top?: number
        }
        const t = Math.min(Math.max(1, top ?? 20), 50)
        const url = `${GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=${t}`
        const json = await graphGet<{
          value?: Array<{
            id: string
            createdDateTime?: string
            from?: { user?: { id?: string; displayName?: string } }
            body?: { contentType?: string; content?: string }
          }>
        }>(url, accessToken, inv.source.id)
        const messages = (json.value ?? []).map((m) => ({
          id: m.id,
          createdAt: m.createdDateTime,
          from: m.from?.user
            ? { id: m.from.user.id, displayName: m.from.user.displayName }
            : null,
          body: m.body
            ? { contentType: m.body.contentType, content: m.body.content }
            : null,
        }))
        return { data: { messages }, fetchedAt: Date.now() }
      }
      if (inv.capabilityName === 'lookup_user') {
        const { email } = inv.args as { email: string }
        // Graph's /users?$filter resolves on mail OR userPrincipalName;
        // either can be missing on a particular user, so OR both fields.
        const filter = `mail eq '${escapeOData(email)}' or userPrincipalName eq '${escapeOData(email)}'`
        const url = `${GRAPH}/users?$select=id,displayName,mail,userPrincipalName&$filter=${encodeURIComponent(filter)}`
        const json = await graphGet<{
          value?: Array<{ id: string; displayName?: string; mail?: string; userPrincipalName?: string }>
        }>(url, accessToken, inv.source.id)
        const user = (json.value ?? [])[0]
        if (!user) return { data: { found: false }, fetchedAt: Date.now() }
        return {
          data: {
            found: true,
            user: {
              id: user.id,
              displayName: user.displayName,
              mail: user.mail,
              userPrincipalName: user.userPrincipalName,
            },
          },
          fetchedAt: Date.now(),
        }
      }
      throw new Error(`microsoft-teams: unknown read capability ${inv.capabilityName}`)
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
      if (inv.capabilityName === 'post_channel_message') {
        const { teamId, channelId, content, contentType } = inv.args as {
          teamId: string
          channelId: string
          content: string
          contentType?: 'text' | 'html'
        }
        const url = `${GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`
        const body = { body: { contentType: contentType ?? 'text', content } }
        const json = await graphPost<{
          id: string
          webUrl?: string
          createdDateTime?: string
        }>(url, accessToken, body, inv.source.id, 'post_channel_message')
        return {
          status: 'committed',
          data: { id: json.id, webUrl: json.webUrl, createdAt: json.createdDateTime },
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'post_chat_message') {
        const { chatId, content, contentType } = inv.args as {
          chatId: string
          content: string
          contentType?: 'text' | 'html'
        }
        const url = `${GRAPH}/chats/${encodeURIComponent(chatId)}/messages`
        const body = { body: { contentType: contentType ?? 'text', content } }
        const json = await graphPost<{
          id: string
          webUrl?: string
          createdDateTime?: string
        }>(url, accessToken, body, inv.source.id, 'post_chat_message')
        return {
          status: 'committed',
          data: { id: json.id, webUrl: json.webUrl, createdAt: json.createdDateTime },
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      throw new Error(`microsoft-teams: unknown mutation capability ${inv.capabilityName}`)
    },

    async exchangeOAuth(input) {
      if (!clientId || !clientSecret) {
        throw new Error('Microsoft OAuth client not configured (MS_OAUTH_CLIENT_ID / _SECRET)')
      }
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
        scopes: tokens.scope?.split(/\s+/) ?? SCOPES,
        metadata: {},
      }
    },

    async refreshToken(creds) {
      if (creds.kind !== 'oauth2' || !creds.refreshToken) {
        throw new Error('microsoft-teams.refreshToken: missing refresh token')
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
        const accessToken = await ensureFreshAccessToken(source.credentials, clientId, clientSecret)
        // Cheapest call that proves the grant: GET /me. Same as the
        // calendar adapter — we share the M365 user identity.
        const res = await fetch(`${GRAPH}/me?$select=id`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: `Microsoft rejected token (${res.status}) — reconnect required` }
        }
        if (!res.ok) return { ok: false, reason: `Microsoft Graph returned ${res.status}` }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
  return adapter
}

async function ensureFreshAccessToken(
  creds: ConnectorCredentials,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('microsoft-teams: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Microsoft Teams access token expired and no refresh token', '')
  }
  const refreshed = await refreshAccessToken({
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    refreshToken: creds.refreshToken,
  })
  creds.accessToken = refreshed.accessToken
  creds.expiresAt = refreshed.expiresIn ? Date.now() + refreshed.expiresIn * 1000 : undefined
  if (refreshed.refreshToken) creds.refreshToken = refreshed.refreshToken
  return creds.accessToken
}

async function graphGet<T>(url: string, accessToken: string, dataSourceId: string): Promise<T> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Microsoft Graph rejected token (${res.status})`, dataSourceId)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`microsoft-teams GET ${url} ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

async function graphPost<T>(
  url: string,
  accessToken: string,
  body: unknown,
  dataSourceId: string,
  op: string,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Microsoft Graph rejected token (${res.status})`, dataSourceId)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`microsoft-teams ${op} ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** OData $filter string-literal escape — single quotes are doubled, no
 *  other escapes apply. Used by lookup_user. */
function escapeOData(value: string): string {
  return value.replace(/'/g, "''")
}
