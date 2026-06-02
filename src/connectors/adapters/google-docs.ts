/**
 * @stable Google Docs connector — read + draft surface for doc-flow agents.
 *
 * Three capabilities, picked to cover the "agent reads a doc the user
 * pointed at, then composes a draft into a new doc" workflow without
 * trying to expose Docs' full editing grammar (suggestions, comments,
 * structured headings — all separate packs):
 *
 *   get_document(documentId)
 *     → {documentId, title, body: { content: string }, revisionId}
 *     Read. GET /v1/documents/{documentId}. We collapse the structured
 *     `body.content[]` block stream into a single plaintext string so
 *     the agent layer doesn't have to walk Docs' nested paragraph /
 *     textRun / sectionBreak tree. The full structure is preserved at
 *     `body.structured` for callers that need it.
 *
 *   create_document(title, body?)
 *     → {documentId, title, revisionId}
 *     Mutation. POST /v1/documents to create a fresh doc, then — if
 *     `body` was supplied — POST /v1/documents/{id}:batchUpdate with a
 *     single `insertText` request targeting index 1. Two-step because
 *     documents.create only accepts `title`; everything else is a
 *     batchUpdate. CAS: native-idempotency by way of MutationGuard's
 *     idempotency-key short-circuit (Docs API has no requestId on
 *     create, so retries above the connector are the prevention).
 *
 *   append_text(documentId, text, requiredRevisionId?)
 *     → {documentId, revisionId}
 *     Mutation. POST /v1/documents/{id}:batchUpdate with one
 *     `insertText` request at the doc's end. When `requiredRevisionId`
 *     is supplied we attach it to the batchUpdate request — Docs
 *     rejects with 400 + status code FAILED_PRECONDITION if another
 *     writer beat us, which we surface as ResourceContention. This is
 *     real CAS at the Docs API level (writeControl.requiredRevisionId).
 *
 * Auth: OAuth2 with `documents` (read+write). We also include
 * `drive.file` so create_document yields docs the connecting user can
 * subsequently see in Drive — without it, Docs created via the API
 * are owned by the user but invisible in their Drive UI (a Docs API
 * documented quirk).
 *
 * Why no "find by title" capability: Docs API has no search endpoint;
 * that surface belongs in the Google Drive connector
 * (files.list with mimeType='application/vnd.google-apps.document').
 * The two adapters compose at the agent layer.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type ConnectorCredentials,
  ResourceContention,
  CredentialsExpired,
} from '../types.js'
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '../oauth.js'

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
]
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://docs.googleapis.com/v1'
// Trash + export live on the Drive API, not the Docs API. drive.file scope
// limits access to files created or opened by this app — sufficient for
// docs the agent itself authored, and the only scope we already hold.
const DRIVE_API = 'https://www.googleapis.com/drive/v3'

const EXPORT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  html: 'text/html',
  text: 'text/plain',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
  markdown: 'text/markdown',
  md: 'text/markdown',
}

/** OAuth client config the factory closes over. */
export interface GoogleDocsOptions {
  clientId: string
  clientSecret: string
  /** Default request timeout in ms. Applied per-fetch via AbortSignal. */
  timeoutMs?: number
}

export function googleDocs(opts: GoogleDocsOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const timeoutMs = opts.timeoutMs ?? 30_000
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'google-docs',
      displayName: 'Google Docs',
      description:
        'Read and draft into the user\'s Google Docs. Fetch a document\'s plaintext body, create a new doc from a title + initial body, and append text with optional revision-id CAS guarding concurrent edits.',
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes: SCOPES,
        clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
        clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
        extraAuthParams: {
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true',
        },
      },
      category: 'doc',
      defaultConsistencyModel: 'authoritative',
      rateLimit: { requests: 300, windowMs: 60_000, scope: 'oauth-client' },
      capabilities: [
        {
          name: 'get_document',
          class: 'read',
          description:
            'Fetch a Google Doc by id. Returns the title, the plaintext body (paragraph + textRun blocks collapsed), the underlying structured content for callers that need it, and the current revisionId for use as CAS on subsequent writes.',
          parameters: {
            type: 'object',
            properties: {
              documentId: { type: 'string', description: 'Docs document id (the slug after /document/d/ in the URL).' },
            },
            required: ['documentId'],
          },
        },
        {
          name: 'create_document',
          class: 'mutation',
          description:
            'Create a new Google Doc with the given title. When `body` is supplied the text is inserted at the start of the doc via a follow-up batchUpdate. Returns the new documentId + revisionId.',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Title shown in Drive and the Docs tab.' },
              body: { type: 'string', description: 'Optional plaintext body to insert at index 1 immediately after create.' },
            },
            required: ['title'],
          },
        },
        {
          name: 'append_text',
          class: 'mutation',
          description:
            'Append plaintext to the end of an existing Doc via a single insertText batchUpdate. When `requiredRevisionId` is supplied the request is rejected by Docs if any other writer has committed between read and write — surfaced as ResourceContention.',
          cas: 'etag-if-match',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              documentId: { type: 'string' },
              text: { type: 'string', description: 'Plaintext to append (a leading newline is added if the doc is non-empty).' },
              requiredRevisionId: {
                type: 'string',
                description: 'Optional revisionId from a prior get_document; when present, request fails fast on a concurrent edit.',
              },
            },
            required: ['documentId', 'text'],
          },
        },
        {
          name: 'delete_document',
          class: 'mutation',
          description:
            'Trash a Google Doc via the Drive API (PATCH /drive/v3/files/{id} with trashed=true). Trashing is idempotent: repeating the call leaves the file in the trash and yields the same response. Requires drive.file scope on a file this app created or opened.',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              documentId: { type: 'string', description: 'Docs document id (also the Drive file id).' },
            },
            required: ['documentId'],
          },
        },
        {
          name: 'export_document',
          class: 'read',
          description:
            'Export a Google Doc to PDF, HTML, plaintext, DOCX, ODT, RTF, EPUB, or Markdown via the Drive API export endpoint. Returns the exported bytes as a base64 string + the resolved mime type. `format` is a friendly alias (pdf|html|text|docx|odt|rtf|epub|markdown); pass `mimeType` to use any other Drive-supported export mime.',
          parameters: {
            type: 'object',
            properties: {
              documentId: { type: 'string' },
              format: {
                type: 'string',
                description: 'Friendly format alias: pdf, html, text, docx, odt, rtf, epub, markdown.',
              },
              mimeType: {
                type: 'string',
                description: 'Explicit export mime type (overrides `format`).',
              },
            },
            required: ['documentId'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
      if (inv.capabilityName === 'get_document') return getDocument(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'export_document') return exportDocument(inv, accessToken, timeoutMs)
      throw new Error(`google-docs: unknown read capability ${inv.capabilityName}`)
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
      if (inv.capabilityName === 'create_document') return createDocument(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'append_text') return appendText(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'delete_document') return deleteDocument(inv, accessToken, timeoutMs)
      throw new Error(`google-docs: unknown mutation capability ${inv.capabilityName}`)
    },

    async exchangeOAuth(input) {
      if (!clientId || !clientSecret) {
        throw new Error('Google OAuth client not configured (GOOGLE_OAUTH_CLIENT_ID / _SECRET)')
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
        throw new Error('google-docs.refreshToken: missing refresh token')
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
        // Docs API has no /me-style probe; the cheapest auth proof is
        // userinfo on the OAuth2 endpoint, which validates the access
        // token without needing a doc id we don't have.
        const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: `Google rejected Docs token (${res.status}) — reconnect required` }
        }
        if (!res.ok) return { ok: false, reason: `Google userinfo returned ${res.status}` }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
  return adapter
}

interface DocsTextRun {
  content?: string
}
interface DocsParagraphElement {
  textRun?: DocsTextRun
}
interface DocsParagraph {
  elements?: DocsParagraphElement[]
}
interface DocsStructuralElement {
  paragraph?: DocsParagraph
  endIndex?: number
}
interface DocsDocument {
  documentId: string
  title?: string
  revisionId?: string
  body?: { content?: DocsStructuralElement[] }
}

/** Walk the Docs body.content[] tree and concatenate every textRun. The
 *  Docs schema represents paragraphs as arrays of elements, each of which
 *  may carry a `textRun.content` string. Non-text elements (page breaks,
 *  inline objects, equations) contribute nothing — we drop them rather
 *  than emit sentinel markers, which keeps the plaintext clean for
 *  LLM ingestion. Callers that need the structured tree get it back on
 *  `body.structured`. */
function collapseDocBody(doc: DocsDocument): string {
  const out: string[] = []
  for (const el of doc.body?.content ?? []) {
    const para = el.paragraph
    if (!para?.elements) continue
    for (const pe of para.elements) {
      const t = pe.textRun?.content
      if (typeof t === 'string') out.push(t)
    }
  }
  return out.join('')
}

/** Walk body.content[] backward to find the highest endIndex. The Docs
 *  API treats endIndex as 1-past-the-last character; insertText at
 *  `endIndex - 1` appends without splitting the trailing newline that
 *  every Doc carries. Falls back to 1 (the first valid insert index)
 *  for a doc with no body. */
function findAppendIndex(doc: DocsDocument): number {
  const content = doc.body?.content
  if (!content || content.length === 0) return 1
  let maxEnd = 1
  for (const el of content) {
    if (typeof el.endIndex === 'number' && el.endIndex > maxEnd) maxEnd = el.endIndex
  }
  // endIndex of the last segmentEnd block points 1 past the implicit
  // trailing newline; inserting AT that index would land after EOF and
  // 400. Subtract 1 to land just before the trailing newline.
  return Math.max(1, maxEnd - 1)
}

async function getDocument(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { documentId } = (inv.args ?? {}) as { documentId: string }
  const res = await fetch(`${API}/documents/${encodeURIComponent(documentId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Docs rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 404) {
    throw new Error(`google-docs get_document: document ${documentId} not found`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-docs get_document ${res.status}: ${text.slice(0, 200)}`)
  }
  const doc = (await res.json()) as DocsDocument
  return {
    data: {
      documentId: doc.documentId,
      title: doc.title,
      revisionId: doc.revisionId,
      body: {
        content: collapseDocBody(doc),
        structured: doc.body?.content ?? [],
      },
    },
    etag: doc.revisionId,
    fetchedAt: Date.now(),
  }
}

async function createDocument(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { title, body } = (inv.args ?? {}) as { title: string; body?: string }
  if (!title || typeof title !== 'string') {
    throw new Error('google-docs create_document: title is required')
  }
  const createRes = await fetch(`${API}/documents`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ title }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (createRes.status === 401 || createRes.status === 403) {
    throw new CredentialsExpired(`Google Docs rejected token (${createRes.status})`, inv.source.id)
  }
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '')
    throw new Error(`google-docs create_document ${createRes.status}: ${text.slice(0, 200)}`)
  }
  const created = (await createRes.json()) as DocsDocument
  let revisionId = created.revisionId

  if (typeof body === 'string' && body.length > 0) {
    const insertRes = await fetch(
      `${API}/documents/${encodeURIComponent(created.documentId)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: body,
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
    if (insertRes.status === 401 || insertRes.status === 403) {
      throw new CredentialsExpired(`Google Docs rejected token (${insertRes.status})`, inv.source.id)
    }
    if (!insertRes.ok) {
      const text = await insertRes.text().catch(() => '')
      throw new Error(`google-docs create_document insertText ${insertRes.status}: ${text.slice(0, 200)}`)
    }
    const insertJson = (await insertRes.json()) as { documentId?: string; writeControl?: { requiredRevisionId?: string } }
    // batchUpdate returns the post-update revision in writeControl on
    // success. Fall back to the create revision if the field shape
    // shifts under a future Docs API change.
    revisionId = insertJson.writeControl?.requiredRevisionId ?? revisionId
  }

  return {
    status: 'committed',
    data: { documentId: created.documentId, title: created.title, revisionId },
    etagAfter: revisionId,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function appendText(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { documentId, text, requiredRevisionId } = (inv.args ?? {}) as {
    documentId: string
    text: string
    requiredRevisionId?: string
  }
  if (!text) {
    throw new Error('google-docs append_text: text is required')
  }

  // Fetch the doc to locate the append index. Docs API has no "append"
  // primitive — every insert is index-based.
  const docRes = await fetch(`${API}/documents/${encodeURIComponent(documentId)}?fields=documentId,revisionId,body(content(endIndex))`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (docRes.status === 401 || docRes.status === 403) {
    throw new CredentialsExpired(`Google Docs rejected token (${docRes.status})`, inv.source.id)
  }
  if (docRes.status === 404) {
    throw new Error(`google-docs append_text: document ${documentId} not found`)
  }
  if (!docRes.ok) {
    const errText = await docRes.text().catch(() => '')
    throw new Error(`google-docs append_text fetch ${docRes.status}: ${errText.slice(0, 200)}`)
  }
  const doc = (await docRes.json()) as DocsDocument
  const insertIndex = findAppendIndex(doc)

  const body: Record<string, unknown> = {
    requests: [
      {
        insertText: {
          location: { index: insertIndex },
          text,
        },
      },
    ],
  }
  if (requiredRevisionId) {
    body.writeControl = { requiredRevisionId }
  }

  const res = await fetch(
    `${API}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
  )
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Docs rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 400 && requiredRevisionId) {
    // Docs returns 400 with status code FAILED_PRECONDITION when
    // requiredRevisionId is stale. Best-effort parse — surface the
    // server text in the error payload either way.
    const errBody = await res.text().catch(() => '')
    if (/FAILED_PRECONDITION|requiredRevisionId/i.test(errBody)) {
      throw new ResourceContention(
        `Google Docs reported a concurrent edit on append_text (revisionId ${requiredRevisionId} stale)`,
        [],
        { rawError: errBody.slice(0, 400) },
      )
    }
    throw new Error(`google-docs append_text ${res.status}: ${errBody.slice(0, 200)}`)
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`google-docs append_text ${res.status}: ${errBody.slice(0, 200)}`)
  }
  const json = (await res.json()) as { writeControl?: { requiredRevisionId?: string } }
  return {
    status: 'committed',
    data: { documentId, revisionId: json.writeControl?.requiredRevisionId },
    etagAfter: json.writeControl?.requiredRevisionId,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function deleteDocument(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { documentId } = (inv.args ?? {}) as { documentId: string }
  if (!documentId) {
    throw new Error('google-docs delete_document: documentId is required')
  }
  // Trash via the Drive API: PATCH /files/{id} body { trashed: true }.
  // Repeating the request is a no-op (the file stays trashed and the
  // response shape is identical) — that is the contract behind
  // cas: 'native-idempotency' on this capability.
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(documentId)}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ trashed: true }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Docs rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 404) {
    throw new Error(`google-docs delete_document: document ${documentId} not found`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-docs delete_document ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string; trashed?: boolean }
  return {
    status: 'committed',
    data: { documentId: json.id ?? documentId, trashed: json.trashed ?? true },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function exportDocument(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { documentId, format, mimeType } = (inv.args ?? {}) as {
    documentId: string
    format?: string
    mimeType?: string
  }
  if (!documentId) {
    throw new Error('google-docs export_document: documentId is required')
  }
  const resolvedMime = mimeType ?? (format ? EXPORT_MIME[format.toLowerCase()] : undefined)
  if (!resolvedMime) {
    throw new Error(
      'google-docs export_document: format must be one of pdf|html|text|docx|odt|rtf|epub|markdown, or pass mimeType explicitly',
    )
  }
  const url = `${DRIVE_API}/files/${encodeURIComponent(documentId)}/export?mimeType=${encodeURIComponent(resolvedMime)}`
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Docs rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 404) {
    throw new Error(`google-docs export_document: document ${documentId} not found`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-docs export_document ${res.status}: ${text.slice(0, 200)}`)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  // base64 encode without a Buffer dependency (works in worker + node).
  let binary = ''
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i])
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64')
  return {
    data: {
      documentId,
      mimeType: resolvedMime,
      byteLength: buf.length,
      contentBase64: base64,
    },
    fetchedAt: Date.now(),
  }
}

async function ensureFreshAccessToken(
  creds: ConnectorCredentials,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('google-docs: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Google Docs access token expired and no refresh token', '')
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
