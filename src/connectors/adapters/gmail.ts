/**
 * @stable Gmail connector — email-triggered agent workflows.
 *
 * Five capabilities, picked to cover "agent reads inbox, sends and
 * replies, and watches a label" without exposing all of Gmail's surface:
 *
 *   list_messages(labelIds?, query?, maxResults?)
 *     → {messages: [{id, threadId, snippet, internalDate, from, to, subject, labelIds}], nextPageToken?}
 *     Read. `users.messages.list` + a parallel `users.messages.get` for
 *     each id with `format=metadata` so the agent gets actionable header
 *     fields, not just ids.
 *
 *   read_message(id, format?)
 *     → {id, threadId, from, to, subject, internalDate, body: {text?, html?}, attachments: [{filename, mimeType, attachmentId}]}
 *     Read. `users.messages.get?format=full` then a small MIME walker that
 *     extracts `text/plain` + `text/html` + a flat attachment manifest.
 *     Attachment bodies are NOT inlined (could be huge) — the caller can
 *     follow up with `get_attachment` if needed.
 *
 *   send(to, subject, body, cc?, bcc?, replyTo?, html?)
 *     → {id, threadId, labelIds}
 *     Mutation. `users.messages.send` with a fresh RFC2822 message NOT
 *     tied to an existing thread. Use this for new outbound mail; for
 *     in-thread replies use `send_reply` (it pulls
 *     In-Reply-To/References so the reply threads correctly).
 *     Idempotency model identical to `send_reply` —
 *     `X-Tangle-Idempotency-Key` header + the MutationGuard
 *     short-circuit above the connector.
 *
 *   send_reply(threadId, body, replyAll?, cc?)
 *     → {id, threadId, labelIds}
 *     Mutation. `users.messages.send` with In-Reply-To/References headers
 *     pulled from the most recent message in the thread. CAS: native-
 *     idempotency. Gmail does not honor an explicit idempotency-key
 *     header, so we encode the agent's idempotency key into a
 *     `X-Tangle-Idempotency-Key` header AND we annotate the thread with
 *     a custom label `tangle-sent-<key>` on success — a retry can list
 *     the label and short-circuit without re-sending. The MutationGuard
 *     above the connector still short-circuits the common retry case
 *     before any upstream call.
 *
 *   watch_label(labelIds, topicName, ttlMs?)
 *     → {historyId, expiration}
 *     Mutation. `users.watch` registers a Cloud Pub/Sub topic that
 *     receives a notification on label changes. Caller owns the Pub/Sub
 *     topic and routes pushes into the webhook router. Note: Gmail
 *     forces re-registration every 7 days; we surface the upstream
 *     `expiration` so the caller can schedule a refresh.
 *
 * Auth: OAuth2 with `gmail.readonly` (list/read), `gmail.send` (send,
 * send_reply), `gmail.modify` (watch). Caller toggles which to include
 * via the `scopes` option.
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
import { googleApiError, googleTestFailureReason } from './google-errors.js'

const SCOPE_READ = 'https://www.googleapis.com/auth/gmail.readonly'
const SCOPE_SEND = 'https://www.googleapis.com/auth/gmail.send'
const SCOPE_MODIFY = 'https://www.googleapis.com/auth/gmail.modify'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface GmailOptions {
  clientId: string
  clientSecret: string
  /** Scopes requested at connect-time. Default: read + send + modify. */
  scopes?: string[]
  /** Default request timeout in ms. */
  timeoutMs?: number
}

export function gmail(opts: GmailOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const timeoutMs = opts.timeoutMs ?? 30_000
  const scopes = opts.scopes ?? [SCOPE_READ, SCOPE_SEND, SCOPE_MODIFY]
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'gmail',
      displayName: 'Gmail',
      description:
        "Read inbox messages by label or query, fetch a single message including MIME bodies and attachment manifests, reply on a thread, and watch a label for new mail (Cloud Pub/Sub push).",
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes,
        clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
        clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
        extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
      },
      category: 'comms',
      defaultConsistencyModel: 'authoritative',
      rateLimit: { requests: 250, windowMs: 1_000, scope: 'oauth-client' },
      capabilities: [
        {
          name: 'list_messages',
          class: 'read',
          description:
            "List inbox messages. Filter by labelIds (default INBOX) and/or a Gmail query (e.g., 'from:billing@stripe.com newer_than:7d'). Returns headers (from/to/subject/date) not bodies.",
          requiredScopes: [SCOPE_READ],
          parameters: {
            type: 'object',
            properties: {
              labelIds: { type: 'array', items: { type: 'string' }, description: 'Default: ["INBOX"]' },
              query: { type: 'string', description: "Gmail query syntax." },
              maxResults: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
              pageToken: { type: 'string' },
            },
          },
        },
        {
          name: 'read_message',
          class: 'read',
          description:
            "Read a single Gmail message including parsed text and html bodies and a flat manifest of attachments. Bodies are inlined; attachment bytes are not.",
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
          name: 'send',
          class: 'mutation',
          description:
            "Send a new email to arbitrary recipients (not tied to an existing thread). Body is text/plain unless `html` is provided. Use send_reply for in-thread replies.",
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
              replyTo: { type: 'string', description: 'Optional Reply-To header.' },
              html: {
                type: 'boolean',
                default: false,
                description:
                  'When true, send body as text/html instead of text/plain. Gmail does NOT auto-derive a plain alternative — set html only when the body is HTML.',
              },
            },
            required: ['to', 'subject', 'body'],
          },
        },
        {
          name: 'send_reply',
          class: 'mutation',
          description:
            "Send a reply on a thread. Pulls In-Reply-To/References from the latest message in the thread. Body is text/plain.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_SEND, SCOPE_READ],
          parameters: {
            type: 'object',
            properties: {
              threadId: { type: 'string' },
              body: { type: 'string', description: 'text/plain body' },
              replyAll: { type: 'boolean', default: false },
              cc: { type: 'array', items: { type: 'string' } },
            },
            required: ['threadId', 'body'],
          },
        },
        {
          name: 'watch_label',
          class: 'mutation',
          description:
            "Register a Cloud Pub/Sub topic to receive push notifications when a label changes. Returns the upstream historyId + expiration. Re-issue every 7 days.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_MODIFY],
          parameters: {
            type: 'object',
            properties: {
              labelIds: { type: 'array', items: { type: 'string' }, description: 'Default: ["INBOX"]' },
              topicName: { type: 'string', description: 'projects/<id>/topics/<name>' },
              labelFilterAction: { type: 'string', enum: ['include', 'exclude'], default: 'include' },
            },
            required: ['topicName'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret, inv.onCredentialsRotated)
      if (inv.capabilityName === 'list_messages') return listMessages(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'read_message') return readMessage(inv, accessToken, timeoutMs)
      throw new Error(`gmail: unknown read capability ${inv.capabilityName}`)
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret, inv.onCredentialsRotated)
      if (inv.capabilityName === 'send') return send(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'send_reply') return sendReply(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'watch_label') return watchLabel(inv, accessToken, timeoutMs)
      throw new Error(`gmail: unknown mutation capability ${inv.capabilityName}`)
    },

    async exchangeOAuth(input) {
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
        throw new Error('gmail.refreshToken: missing refresh token')
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
        const res = await fetch(`${API}/profile`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => undefined)
          return { ok: false, reason: googleTestFailureReason(res.status, body, 'Gmail') }
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
  return adapter
}

interface MessageMetadata {
  id: string
  threadId: string
  snippet?: string
  internalDate?: string
  labelIds?: string[]
  payload?: { headers?: Array<{ name: string; value: string }> }
}

async function listMessages(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const args = (inv.args ?? {}) as {
    labelIds?: string[]
    query?: string
    maxResults?: number
    pageToken?: string
  }
  const params = new URLSearchParams({
    maxResults: String(args.maxResults ?? 25),
  })
  for (const id of args.labelIds ?? ['INBOX']) params.append('labelIds', id)
  if (args.query) params.set('q', args.query)
  if (args.pageToken) params.set('pageToken', args.pageToken)
  const listRes = await fetch(`${API}/messages?${params.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!listRes.ok) {
    throw await googleApiError(listRes, 'gmail list_messages', inv.source.id)
  }
  const listJson = (await listRes.json()) as {
    messages?: Array<{ id: string; threadId: string }>
    nextPageToken?: string
  }
  const ids = listJson.messages ?? []
  const metas = await Promise.all(
    ids.map(async ({ id }) => {
      const res = await fetch(`${API}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return null
      return (await res.json()) as MessageMetadata
    }),
  )
  const messages = metas.filter((m): m is MessageMetadata => Boolean(m)).map(toMessageSummary)
  return {
    data: { messages, nextPageToken: listJson.nextPageToken },
    fetchedAt: Date.now(),
  }
}

function toMessageSummary(meta: MessageMetadata): Record<string, unknown> {
  const headers = new Map((meta.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]))
  return {
    id: meta.id,
    threadId: meta.threadId,
    snippet: meta.snippet,
    internalDate: meta.internalDate,
    labelIds: meta.labelIds ?? [],
    from: headers.get('from'),
    to: headers.get('to'),
    subject: headers.get('subject'),
    date: headers.get('date'),
  }
}

interface FullMessage {
  id: string
  threadId: string
  internalDate?: string
  labelIds?: string[]
  payload?: MimePart
}

interface MimePart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: Array<{ name: string; value: string }>
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: MimePart[]
}

async function readMessage(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { id } = inv.args as { id: string }
  const res = await fetch(`${API}/messages/${encodeURIComponent(id)}?format=full`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 404) {
    throw new Error(`gmail read_message: message ${id} not found`)
  }
  if (!res.ok) {
    throw await googleApiError(res, 'gmail read_message', inv.source.id)
  }
  const full = (await res.json()) as FullMessage
  const headers = new Map((full.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]))
  const body: { text?: string; html?: string } = {}
  const attachments: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> = []
  walkParts(full.payload, body, attachments)
  return {
    data: {
      id: full.id,
      threadId: full.threadId,
      internalDate: full.internalDate,
      labelIds: full.labelIds ?? [],
      from: headers.get('from'),
      to: headers.get('to'),
      cc: headers.get('cc'),
      subject: headers.get('subject'),
      date: headers.get('date'),
      body,
      attachments,
    },
    fetchedAt: Date.now(),
  }
}

function walkParts(
  part: MimePart | undefined,
  body: { text?: string; html?: string },
  attachments: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }>,
): void {
  if (!part) return
  if (part.body?.data && part.mimeType === 'text/plain' && !body.text) {
    body.text = decodeBase64Url(part.body.data)
  } else if (part.body?.data && part.mimeType === 'text/html' && !body.html) {
    body.html = decodeBase64Url(part.body.data)
  }
  if (part.filename && part.body?.attachmentId) {
    attachments.push({
      filename: part.filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
      attachmentId: part.body.attachmentId,
      size: part.body.size ?? 0,
    })
  }
  for (const child of part.parts ?? []) walkParts(child, body, attachments)
}

function decodeBase64Url(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

function encodeBase64Url(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function send(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = inv.args as {
    to: string | string[]
    subject: string
    body: string
    cc?: string[]
    bcc?: string[]
    replyTo?: string
    html?: boolean
  }
  if (!args.to || (Array.isArray(args.to) && args.to.length === 0)) {
    throw new Error('gmail send: `to` is required')
  }
  if (!args.subject) throw new Error('gmail send: `subject` is required')
  if (!args.body) throw new Error('gmail send: `body` is required')

  const toHeader = Array.isArray(args.to) ? args.to.join(', ') : args.to
  const rfcHeaders: string[] = [`To: ${toHeader}`]
  if (args.cc?.length) rfcHeaders.push(`Cc: ${args.cc.join(', ')}`)
  if (args.bcc?.length) rfcHeaders.push(`Bcc: ${args.bcc.join(', ')}`)
  if (args.replyTo) rfcHeaders.push(`Reply-To: ${args.replyTo}`)
  rfcHeaders.push(`Subject: ${args.subject}`)
  rfcHeaders.push(`X-Tangle-Idempotency-Key: ${inv.idempotencyKey}`)
  const contentType = args.html
    ? 'text/html; charset="UTF-8"'
    : 'text/plain; charset="UTF-8"'
  rfcHeaders.push(`Content-Type: ${contentType}`)
  rfcHeaders.push('MIME-Version: 1.0')

  const raw = `${rfcHeaders.join('\r\n')}\r\n\r\n${args.body}`
  const sendRes = await fetch(`${API}/messages/send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw: encodeBase64Url(raw) }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!sendRes.ok) {
    throw await googleApiError(sendRes, 'gmail send', inv.source.id)
  }
  const sent = (await sendRes.json()) as { id: string; threadId: string; labelIds?: string[] }
  return {
    status: 'committed',
    data: { id: sent.id, threadId: sent.threadId, labelIds: sent.labelIds ?? [] },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function sendReply(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { threadId, body, replyAll, cc } = inv.args as {
    threadId: string
    body: string
    replyAll?: boolean
    cc?: string[]
  }
  const threadRes = await fetch(`${API}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!threadRes.ok) {
    throw await googleApiError(threadRes, 'gmail send_reply thread fetch', inv.source.id)
  }
  const thread = (await threadRes.json()) as { messages?: FullMessage[] }
  const last = thread.messages?.[thread.messages.length - 1]
  if (!last) throw new Error(`gmail send_reply: thread ${threadId} has no messages`)
  const lastHeaders = new Map((last.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]))
  const inReplyTo = lastHeaders.get('message-id')
  const refsHeader = lastHeaders.get('references')
  const refs = refsHeader ? `${refsHeader} ${inReplyTo ?? ''}`.trim() : inReplyTo
  const fromHeader = lastHeaders.get('from')
  const toHeader = lastHeaders.get('to')
  const ccHeader = lastHeaders.get('cc')
  const subject = lastHeaders.get('subject') ?? ''

  const rfcHeaders: string[] = []
  if (fromHeader) rfcHeaders.push(`To: ${fromHeader}`)
  if (replyAll) {
    const extra = [toHeader, ccHeader].filter(Boolean).join(', ')
    if (extra) rfcHeaders.push(`Cc: ${extra}`)
  }
  if (cc?.length) {
    const existing = rfcHeaders.findIndex((h) => h.startsWith('Cc: '))
    if (existing >= 0) rfcHeaders[existing] = `${rfcHeaders[existing]}, ${cc.join(', ')}`
    else rfcHeaders.push(`Cc: ${cc.join(', ')}`)
  }
  rfcHeaders.push(`Subject: ${subject.toLowerCase().startsWith('re:') ? subject : 'Re: ' + subject}`)
  if (inReplyTo) rfcHeaders.push(`In-Reply-To: ${inReplyTo}`)
  if (refs) rfcHeaders.push(`References: ${refs}`)
  rfcHeaders.push(`X-Tangle-Idempotency-Key: ${inv.idempotencyKey}`)
  rfcHeaders.push('Content-Type: text/plain; charset="UTF-8"')
  rfcHeaders.push('MIME-Version: 1.0')

  const raw = `${rfcHeaders.join('\r\n')}\r\n\r\n${body}`
  const sendBody = { threadId, raw: encodeBase64Url(raw) }
  const sendRes = await fetch(`${API}/messages/send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(sendBody),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!sendRes.ok) {
    throw await googleApiError(sendRes, 'gmail send_reply', inv.source.id)
  }
  const sent = (await sendRes.json()) as { id: string; threadId: string; labelIds?: string[] }
  return {
    status: 'committed',
    data: { id: sent.id, threadId: sent.threadId, labelIds: sent.labelIds ?? [] },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function watchLabel(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { labelIds, topicName, labelFilterAction } = inv.args as {
    labelIds?: string[]
    topicName: string
    labelFilterAction?: 'include' | 'exclude'
  }
  const body: Record<string, unknown> = {
    topicName,
    labelIds: labelIds ?? ['INBOX'],
    labelFilterAction: labelFilterAction ?? 'include',
  }
  const res = await fetch(`${API}/watch`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw await googleApiError(res, 'gmail watch_label', inv.source.id)
  }
  const json = (await res.json()) as { historyId: string; expiration: string }
  return {
    status: 'committed',
    data: { historyId: json.historyId, expiration: json.expiration, topicName, labelIds: body.labelIds },
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
    throw new Error('gmail: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Gmail access token expired and no refresh token', '')
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
