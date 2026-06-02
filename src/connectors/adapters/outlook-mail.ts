/**
 * Microsoft Graph Outlook Mail connector — the Microsoft 365 counterpart of
 * the Gmail adapter. Four capabilities mirror the Gmail surface so an agent
 * routes the same intent against either inbox:
 *
 *   list_messages(folder?, query?, top?)
 *     → {messages: [{id, conversationId, subject, from, toRecipients,
 *        receivedDateTime, bodyPreview, isRead, hasAttachments}], nextLink?}
 *     Read. `GET /me/mailFolders/{folder}/messages` with `$select` pinned
 *     to the fields above. `$search`/`$filter` translates the operator's
 *     query. Default folder is the well-known `inbox`.
 *
 *   read_message(id)
 *     → {id, conversationId, subject, from, toRecipients, ccRecipients,
 *        receivedDateTime, body: {contentType, content}, attachments:
 *        [{id, name, contentType, size}]}
 *     Read. `GET /me/messages/{id}?$expand=attachments($select=id,name,...)`.
 *     Attachment bytes are NOT inlined — caller follows up with
 *     `/me/messages/{id}/attachments/{id}/$value` if needed.
 *
 *   send_reply(messageId, body, replyAll?, comment?)
 *     → {sent: true, messageId}
 *     Mutation. `POST /me/messages/{id}/createReply` (or `createReplyAll`)
 *     returns a draft; we patch the body and `POST .../send`. The reply
 *     inherits the original `internetMessageHeaders` so threading sticks.
 *     CAS: native-idempotency. Graph exposes no `Idempotency-Key` header
 *     on `send`, so we tag the draft with an `internetMessageHeaders`
 *     entry `X-Tangle-Idempotency-Key: <key>` AND rely on the
 *     MutationGuard's key short-circuit above the connector to prevent
 *     duplicate sends on retry.
 *
 *   subscribe_folder(folder, notificationUrl, ttlMinutes?)
 *     → {subscriptionId, expirationDateTime, clientState}
 *     Mutation. `POST /subscriptions` registers a webhook for new mail in
 *     a folder. Graph caps `expirationDateTime` at ~4230 minutes (~3
 *     days) for mail; caller is responsible for re-issuing before then.
 *
 * Auth: OAuth2 with `Mail.Read` (list/read), `Mail.Send` (send),
 * `Mail.ReadWrite` (subscriptions), and `offline_access` (required to
 * get a refresh token from the v2.0 endpoint). Caller toggles which to
 * include via the `scopes` option.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type ConnectorCredentials,
  CredentialsExpired,
} from '../types.js'
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '../oauth.js'

const SCOPE_READ = 'https://graph.microsoft.com/Mail.Read'
const SCOPE_SEND = 'https://graph.microsoft.com/Mail.Send'
const SCOPE_RW = 'https://graph.microsoft.com/Mail.ReadWrite'
// offline_access is required to receive a refresh_token from the v2.0
// endpoint; without it Graph hands back access tokens only and the
// connection silently dies after ~1 hour.
const SCOPE_OFFLINE = 'offline_access'
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const API = 'https://graph.microsoft.com/v1.0'

export interface OutlookMailOptions {
  clientId: string
  clientSecret: string
  /** Scopes requested at connect-time. Default: read + send + read-write + offline. */
  scopes?: string[]
  /** Default request timeout in ms. */
  timeoutMs?: number
}

export function outlookMail(opts: OutlookMailOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const timeoutMs = opts.timeoutMs ?? 30_000
  const scopes = opts.scopes ?? [SCOPE_READ, SCOPE_SEND, SCOPE_RW, SCOPE_OFFLINE]
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'outlook-mail',
      displayName: 'Outlook Mail',
      description:
        "Read inbox messages from a Microsoft 365 / Outlook mailbox, fetch a single message with body + attachment manifest, reply on a conversation, and subscribe to a folder for new mail webhooks.",
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes,
        clientIdEnv: 'MS_OAUTH_CLIENT_ID',
        clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
      },
      category: 'comms',
      defaultConsistencyModel: 'authoritative',
      // Graph throttles per-app per-mailbox at roughly 10k requests / 10
      // min for mail. 250/s leaves plenty of headroom and matches the
      // Gmail per-second budget so callers can reason uniformly.
      rateLimit: { requests: 250, windowMs: 1_000, scope: 'oauth-client' },
      capabilities: [
        {
          name: 'list_messages',
          class: 'read',
          description:
            "List mailbox messages in a folder (default 'inbox'). Optional `query` becomes a Graph `$search` (KQL); `top` is the page size (max 1000). Returns headers, no bodies.",
          requiredScopes: [SCOPE_READ],
          parameters: {
            type: 'object',
            properties: {
              folder: { type: 'string', description: "Well-known folder name (inbox, drafts, sentitems, ...) or folder id. Default: 'inbox'." },
              query: { type: 'string', description: "Graph $search KQL, e.g. 'from:billing@stripe.com'." },
              top: { type: 'integer', minimum: 1, maximum: 1000, default: 25 },
              skipToken: { type: 'string', description: 'Opaque pagination cursor from a previous nextLink.' },
            },
          },
        },
        {
          name: 'read_message',
          class: 'read',
          description:
            "Read a single Outlook message including body (HTML or text per upstream content type) and a flat manifest of attachments. Attachment bytes are not inlined.",
          requiredScopes: [SCOPE_READ],
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
            required: ['id'],
          },
        },
        {
          name: 'send_reply',
          class: 'mutation',
          description:
            "Send a reply on a conversation. Uses Graph createReply (or createReplyAll) + patch body + send. Threading via inherited internetMessageHeaders.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_SEND, SCOPE_READ],
          parameters: {
            type: 'object',
            properties: {
              messageId: { type: 'string', description: 'Graph message id to reply to.' },
              body: { type: 'string', description: 'Reply body (text or HTML; see bodyType).' },
              bodyType: { type: 'string', enum: ['text', 'html'], default: 'text' },
              replyAll: { type: 'boolean', default: false },
              comment: { type: 'string', description: 'Optional comment passed to createReply/createReplyAll.' },
            },
            required: ['messageId', 'body'],
          },
        },
        {
          name: 'send_message',
          class: 'mutation',
          description:
            "Send a new email to arbitrary recipients (not tied to an existing conversation). Uses Graph POST /me/sendMail with saveToSentItems=true. Body is text/plain unless `html` is true. Use send_reply for in-thread replies.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_SEND],
          parameters: {
            type: 'object',
            properties: {
              to: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
                description: 'Recipient address(es). String OR array of strings.',
              },
              subject: { type: 'string' },
              body: { type: 'string', description: 'text/plain body (unless html set)' },
              cc: { type: 'array', items: { type: 'string' } },
              bcc: { type: 'array', items: { type: 'string' } },
              html: {
                type: 'boolean',
                default: false,
                description:
                  'When true, set Graph body.contentType=HTML and send body as HTML; otherwise text. Graph does NOT auto-derive a plain alternative — set html only when the body is HTML.',
              },
            },
            required: ['to', 'subject', 'body'],
          },
        },
        {
          name: 'create_draft',
          class: 'mutation',
          description:
            "Create a draft email in the user's Drafts folder via Graph POST /me/messages. Returns the draft message id so callers can patch attachments, then send via a separate /send call.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_RW],
          parameters: {
            type: 'object',
            properties: {
              to: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
                description: 'Recipient address(es). String OR array of strings.',
              },
              subject: { type: 'string' },
              body: { type: 'string', description: 'text/plain body (unless html set)' },
              cc: { type: 'array', items: { type: 'string' } },
              bcc: { type: 'array', items: { type: 'string' } },
              html: {
                type: 'boolean',
                default: false,
                description: 'When true, set Graph body.contentType=HTML; otherwise text.',
              },
            },
            required: ['to', 'subject', 'body'],
          },
        },
        {
          name: 'subscribe_folder',
          class: 'mutation',
          description:
            "Register a Graph webhook subscription for new mail in a folder. Returns the subscription id and expirationDateTime. Mail subscriptions max out at ~3 days; caller must renew.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_RW],
          parameters: {
            type: 'object',
            properties: {
              folder: { type: 'string', description: "Well-known name or folder id. Default: 'inbox'." },
              notificationUrl: { type: 'string', description: 'HTTPS endpoint Graph will POST to.' },
              ttlMinutes: { type: 'integer', minimum: 1, maximum: 4230, default: 4230 },
              clientState: { type: 'string', description: 'Opaque value echoed back on each notification. Defaults to the idempotency key.' },
            },
            required: ['notificationUrl'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret, inv.onCredentialsRotated)
      if (inv.capabilityName === 'list_messages') return listMessages(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'read_message') return readMessage(inv, accessToken, timeoutMs)
      throw new Error(`outlook-mail: unknown read capability ${inv.capabilityName}`)
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret, inv.onCredentialsRotated)
      if (inv.capabilityName === 'send_reply') return sendReply(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'send_message') return sendMessage(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'create_draft') return createDraft(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'subscribe_folder') return subscribeFolder(inv, accessToken, timeoutMs)
      throw new Error(`outlook-mail: unknown mutation capability ${inv.capabilityName}`)
    },

    async exchangeOAuth(input) {
      if (!clientId || !clientSecret) {
        throw new Error('Outlook Mail OAuth client not configured (MS_OAUTH_CLIENT_ID / _SECRET)')
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
        scopes: tokens.scope?.split(/\s+/) ?? scopes,
        metadata: {},
      }
    },

    async refreshToken(creds) {
      if (creds.kind !== 'oauth2' || !creds.refreshToken) {
        throw new Error('outlook-mail.refreshToken: missing refresh token')
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
        const res = await fetch(`${API}/me?$select=id,userPrincipalName`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: `Microsoft rejected Outlook Mail token (${res.status}) — reconnect required` }
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

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string }
}

interface GraphMessage {
  id: string
  conversationId?: string
  subject?: string
  bodyPreview?: string
  receivedDateTime?: string
  isRead?: boolean
  hasAttachments?: boolean
  from?: GraphRecipient
  toRecipients?: GraphRecipient[]
  ccRecipients?: GraphRecipient[]
  body?: { contentType?: 'text' | 'html'; content?: string }
  internetMessageId?: string
  attachments?: Array<{
    id: string
    name?: string
    contentType?: string
    size?: number
    isInline?: boolean
  }>
}

async function listMessages(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const args = (inv.args ?? {}) as {
    folder?: string
    query?: string
    top?: number
    skipToken?: string
  }
  const folder = encodeURIComponent(args.folder ?? 'inbox')
  const params = new URLSearchParams({
    $top: String(args.top ?? 25),
    $select: 'id,conversationId,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,from,toRecipients',
  })
  // $search and $orderby are mutually exclusive in Graph; only emit
  // $orderby when we aren't using $search so the request doesn't 400.
  if (args.query) params.set('$search', `"${args.query}"`)
  else params.set('$orderby', 'receivedDateTime desc')
  if (args.skipToken) params.set('$skiptoken', args.skipToken)

  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` }
  // ConsistencyLevel=eventual is required when $search is used.
  if (args.query) headers['ConsistencyLevel'] = 'eventual'

  const res = await fetch(`${API}/me/mailFolders/${folder}/messages?${params.toString()}`, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Outlook Mail rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`outlook-mail list_messages ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    value?: GraphMessage[]
    '@odata.nextLink'?: string
  }
  const messages = (json.value ?? []).map(toMessageSummary)
  return {
    data: { messages, nextLink: json['@odata.nextLink'] },
    fetchedAt: Date.now(),
  }
}

function toMessageSummary(m: GraphMessage): Record<string, unknown> {
  return {
    id: m.id,
    conversationId: m.conversationId,
    subject: m.subject,
    bodyPreview: m.bodyPreview,
    receivedDateTime: m.receivedDateTime,
    isRead: m.isRead,
    hasAttachments: m.hasAttachments,
    from: m.from?.emailAddress?.address,
    fromName: m.from?.emailAddress?.name,
    to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean),
  }
}

async function readMessage(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { id } = inv.args as { id: string }
  const url = `${API}/me/messages/${encodeURIComponent(id)}?$expand=attachments($select=id,name,contentType,size,isInline)`
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Outlook Mail rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 404) {
    throw new Error(`outlook-mail read_message: message ${id} not found`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`outlook-mail read_message ${res.status}: ${text.slice(0, 200)}`)
  }
  const m = (await res.json()) as GraphMessage
  return {
    data: {
      id: m.id,
      conversationId: m.conversationId,
      subject: m.subject,
      receivedDateTime: m.receivedDateTime,
      from: m.from?.emailAddress?.address,
      fromName: m.from?.emailAddress?.name,
      to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean),
      cc: (m.ccRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean),
      body: {
        contentType: m.body?.contentType ?? 'text',
        content: m.body?.content ?? '',
      },
      attachments: (m.attachments ?? [])
        .filter((a) => !a.isInline)
        .map((a) => ({
          id: a.id,
          name: a.name ?? '',
          contentType: a.contentType ?? 'application/octet-stream',
          size: a.size ?? 0,
        })),
    },
    fetchedAt: Date.now(),
  }
}

async function sendReply(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { messageId, body, bodyType, replyAll, comment } = inv.args as {
    messageId: string
    body: string
    bodyType?: 'text' | 'html'
    replyAll?: boolean
    comment?: string
  }
  const action = replyAll ? 'createReplyAll' : 'createReply'
  // Step 1: createReply returns a draft message with threading headers
  // already populated; we own the draft id from here.
  const draftRes = await fetch(`${API}/me/messages/${encodeURIComponent(messageId)}/${action}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(comment ? { comment } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (draftRes.status === 401 || draftRes.status === 403) {
    throw new CredentialsExpired(`Outlook Mail rejected token (${draftRes.status})`, inv.source.id)
  }
  if (!draftRes.ok) {
    const text = await draftRes.text().catch(() => '')
    throw new Error(`outlook-mail send_reply ${action} ${draftRes.status}: ${text.slice(0, 200)}`)
  }
  const draft = (await draftRes.json()) as { id: string }

  // Step 2: patch the draft body + tag with the idempotency-key header so
  // a forensic search can prove this send was the one and only attempt.
  const patchBody = {
    body: { contentType: bodyType ?? 'text', content: body },
    internetMessageHeaders: [
      { name: 'X-Tangle-Idempotency-Key', value: inv.idempotencyKey },
    ],
  }
  const patchRes = await fetch(`${API}/me/messages/${encodeURIComponent(draft.id)}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(patchBody),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (patchRes.status === 401 || patchRes.status === 403) {
    throw new CredentialsExpired(`Outlook Mail rejected token (${patchRes.status})`, inv.source.id)
  }
  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => '')
    throw new Error(`outlook-mail send_reply patch ${patchRes.status}: ${text.slice(0, 200)}`)
  }

  // Step 3: send the draft. 202 Accepted is the success terminal.
  const sendRes = await fetch(`${API}/me/messages/${encodeURIComponent(draft.id)}/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (sendRes.status === 401 || sendRes.status === 403) {
    throw new CredentialsExpired(`Outlook Mail rejected token (${sendRes.status})`, inv.source.id)
  }
  if (!sendRes.ok && sendRes.status !== 202) {
    const text = await sendRes.text().catch(() => '')
    throw new Error(`outlook-mail send_reply send ${sendRes.status}: ${text.slice(0, 200)}`)
  }

  return {
    status: 'committed',
    data: { sent: true, draftId: draft.id, replyAll: Boolean(replyAll) },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

interface GraphMessagePayload {
  subject: string
  body: { contentType: 'Text' | 'HTML'; content: string }
  toRecipients: Array<{ emailAddress: { address: string } }>
  ccRecipients?: Array<{ emailAddress: { address: string } }>
  bccRecipients?: Array<{ emailAddress: { address: string } }>
  internetMessageHeaders?: Array<{ name: string; value: string }>
}

function buildMessagePayload(
  args: {
    to: string | string[]
    subject: string
    body: string
    cc?: string[]
    bcc?: string[]
    html?: boolean
  },
  idempotencyKey: string,
  cap: 'send_message' | 'create_draft',
): GraphMessagePayload {
  if (!args.to || (Array.isArray(args.to) && args.to.length === 0)) {
    throw new Error(`outlook-mail ${cap}: \`to\` is required`)
  }
  if (!args.subject) throw new Error(`outlook-mail ${cap}: \`subject\` is required`)
  if (!args.body) throw new Error(`outlook-mail ${cap}: \`body\` is required`)
  const toList = Array.isArray(args.to) ? args.to : [args.to]
  const toRecipients = toList.map((address) => ({ emailAddress: { address } }))
  const payload: GraphMessagePayload = {
    subject: args.subject,
    body: {
      contentType: args.html ? 'HTML' : 'Text',
      content: args.body,
    },
    toRecipients,
    // Threading + forensic anchor: tag the message with the dedup key so
    // post-hoc audits can prove this send corresponds to one and only one
    // invocation. Graph preserves internetMessageHeaders on sendMail.
    internetMessageHeaders: [
      { name: 'X-Tangle-Idempotency-Key', value: idempotencyKey },
    ],
  }
  if (args.cc?.length) {
    payload.ccRecipients = args.cc.map((address) => ({ emailAddress: { address } }))
  }
  if (args.bcc?.length) {
    payload.bccRecipients = args.bcc.map((address) => ({ emailAddress: { address } }))
  }
  return payload
}

async function sendMessage(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = (inv.args ?? {}) as {
    to: string | string[]
    subject: string
    body: string
    cc?: string[]
    bcc?: string[]
    html?: boolean
  }
  const message = buildMessagePayload(args, inv.idempotencyKey, 'send_message')
  const res = await fetch(`${API}/me/sendMail`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Outlook Mail rejected token (${res.status})`, inv.source.id)
  }
  // Graph /sendMail is fire-and-forget: 202 Accepted with empty body.
  if (!res.ok && res.status !== 202) {
    const text = await res.text().catch(() => '')
    throw new Error(`outlook-mail send_message ${res.status}: ${text.slice(0, 200)}`)
  }
  return {
    status: 'committed',
    data: {
      sent: true,
      to: Array.isArray(args.to) ? args.to : [args.to],
      subject: args.subject,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function createDraft(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = (inv.args ?? {}) as {
    to: string | string[]
    subject: string
    body: string
    cc?: string[]
    bcc?: string[]
    html?: boolean
  }
  const message = buildMessagePayload(args, inv.idempotencyKey, 'create_draft')
  // POST /me/messages creates a draft by default (isDraft=true is server-set).
  const res = await fetch(`${API}/me/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Outlook Mail rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`outlook-mail create_draft ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    id: string
    conversationId?: string
    webLink?: string
    isDraft?: boolean
  }
  return {
    status: 'committed',
    data: {
      id: json.id,
      conversationId: json.conversationId,
      webLink: json.webLink,
      isDraft: json.isDraft ?? true,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function subscribeFolder(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { folder, notificationUrl, ttlMinutes, clientState } = inv.args as {
    folder?: string
    notificationUrl: string
    ttlMinutes?: number
    clientState?: string
  }
  // Graph caps mail subscriptions at 4230 minutes (just under 3 days).
  const minutes = Math.min(Math.max(ttlMinutes ?? 4230, 1), 4230)
  const expirationDateTime = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  const resource = `me/mailFolders('${folder ?? 'inbox'}')/messages`
  const subBody = {
    changeType: 'created',
    notificationUrl,
    resource,
    expirationDateTime,
    clientState: clientState ?? inv.idempotencyKey,
  }
  const res = await fetch(`${API}/subscriptions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(subBody),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Outlook Mail rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`outlook-mail subscribe_folder ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    id: string
    expirationDateTime: string
    clientState?: string
  }
  return {
    status: 'committed',
    data: {
      subscriptionId: json.id,
      expirationDateTime: json.expirationDateTime,
      clientState: json.clientState,
      resource,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function ensureFreshAccessToken(
  creds: ConnectorCredentials,
  clientId: string,
  clientSecret: string,
  onCredentialsRotated?: (credentials: ConnectorCredentials) => void,
): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('outlook-mail: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Outlook Mail access token expired and no refresh token', '')
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
  onCredentialsRotated?.({
    kind: 'oauth2',
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt,
  })
  return creds.accessToken
}
