/**
 * @stable PandaDoc connector — contract/proposal workflows for sales agents.
 *
 * Five capabilities cover the agent's PandaDoc hot path: discover an
 * existing document, read its current status, draft a new document from a
 * template, send it for signature, and cancel an in-flight document.
 *
 *   search_documents(query?, status?, templateId?, limit?)
 *     → {documents: [{id, name, status, dateCreated, dateModified, ...}], more}
 *     Read. GET /public/v1/documents with `q`, `status`, `template_id`
 *     query params. No CAS — list endpoints are not authoritative.
 *
 *   get_document(documentId)
 *     → {documentId, name, status, dateCreated, dateModified, recipients,
 *        tokens, fields, pricing}
 *     Read. GET /public/v1/documents/:id/details — the only endpoint that
 *     returns recipients + field values + pricing in a single call.
 *
 *   create_document(name, templateId, recipients, tokens?, fields?,
 *                   pricingTables?, metadata?, tags?)
 *     → {documentId, name, status: 'document.uploaded' | 'document.draft', ...}
 *     Mutation. POST /public/v1/documents. PandaDoc has no native
 *     idempotency-key on this endpoint, so we shape the agent contract
 *     around an idempotent metadata fingerprint: the idempotencyKey is
 *     written to `metadata.tangleIdempotencyKey` and we list-search by
 *     that fingerprint before issuing the POST. Race window is acceptable
 *     because the upstream PandaDoc UI is the source of truth — a
 *     duplicated draft surfaces immediately to the human.
 *
 *   send_document(documentId, subject?, message?, sender?, silent?)
 *     → {documentId, status: 'document.sent'}
 *     Mutation. POST /public/v1/documents/:id/send. Append-only state
 *     transition — re-sending an already-sent document returns 400 from
 *     PandaDoc which we surface as a ResourceContention.
 *
 *   cancel_document(documentId, reason?)
 *     → {documentId, status: 'document.voided', voidedAt}
 *     Mutation. POST /public/v1/documents/:id/cancel with `reason` in the
 *     body. Idempotent at the upstream — cancelling an already-cancelled
 *     document is a no-op (200 with the same status), which we surface as
 *     idempotentReplay=true.
 *
 * Auth: OAuth2 (PandaDoc uses `read` / `read+write` scopes). API keys are
 * also supported by PandaDoc but our agent surface assumes the OAuth grant
 * because the customer connects through the hub's OAuth UI.
 *
 * Error taxonomy (mapped via integrations/errors.ts):
 *   401 → provider_auth_failed (CredentialsExpired)
 *   404 → action_not_found (Error) — document/template id unknown
 *   409 → action_denied / ResourceContention (already-sent, already-voided)
 *   429 → provider_rate_limited (status: 'rate-limited' result)
 *   5xx → provider_unavailable
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
import { exchangeAuthorizationCode, refreshAccessToken } from '../oauth.js'

const SCOPES = ['read', 'read+write']
const AUTH_URL = 'https://app.pandadoc.com/oauth2/authorize'
const TOKEN_URL = 'https://api.pandadoc.com/oauth2/access_token'
const API = 'https://api.pandadoc.com/public/v1'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface PandaDocOptions {
  clientId: string
  clientSecret: string
  /** Override the API base URL (mocks, sandbox tenants). */
  baseUrl?: string
  /** Default request timeout in ms. */
  timeoutMs?: number
}

export function pandadoc(opts: PandaDocOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const baseUrl = (opts.baseUrl ?? API).replace(/\/$/, '')
  const timeoutMs = opts.timeoutMs ?? 30_000
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'pandadoc',
      displayName: 'PandaDoc',
      description:
        "Draft contracts and proposals from PandaDoc templates, send them for signature, poll signing status, and cancel in-flight documents.",
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes: SCOPES,
        clientIdEnv: 'PANDADOC_OAUTH_CLIENT_ID',
        clientSecretEnv: 'PANDADOC_OAUTH_CLIENT_SECRET',
      },
      category: 'doc',
      defaultConsistencyModel: 'authoritative',
      capabilities: [
        {
          name: 'search_documents',
          class: 'read',
          description:
            'List PandaDoc documents matching a free-text query, status, or template id. Returns up to `limit` rows (default 25, max 100).',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Free-text query against document name (q=).' },
              status: {
                type: 'string',
                description:
                  "PandaDoc status filter — one of 'document.draft', 'document.sent', 'document.completed', 'document.voided', etc.",
              },
              templateId: { type: 'string' },
              limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            },
          },
        },
        {
          name: 'get_document',
          class: 'read',
          description:
            'Fetch full details for a PandaDoc document: status, recipients, fields, pricing tables, and tokens.',
          parameters: {
            type: 'object',
            properties: { documentId: { type: 'string' } },
            required: ['documentId'],
          },
        },
        {
          name: 'create_document',
          class: 'mutation',
          description:
            'Draft a new PandaDoc document from a template. The idempotencyKey is written to metadata so retries of the same key resolve to the same draft.',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              templateId: { type: 'string', description: 'PandaDoc template uuid.' },
              recipients: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                    role: { type: 'string' },
                    signingOrder: { type: 'integer' },
                  },
                  required: ['email'],
                },
              },
              tokens: {
                type: 'array',
                description: 'Template token substitutions (name/value pairs).',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    value: { type: 'string' },
                  },
                  required: ['name', 'value'],
                },
              },
              fields: {
                type: 'object',
                additionalProperties: { type: 'object', additionalProperties: true },
                description: 'Map of field name → { value, role? } pairs to prefill.',
              },
              pricingTables: { type: 'array', items: { type: 'object', additionalProperties: true } },
              metadata: { type: 'object', additionalProperties: true },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'templateId', 'recipients'],
          },
        },
        {
          name: 'send_document',
          class: 'mutation',
          description:
            'Transition a draft document into the sent state, optionally overriding the email subject and message. Re-sending a sent document is a contention.',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              documentId: { type: 'string' },
              subject: { type: 'string' },
              message: { type: 'string' },
              sender: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                },
              },
              silent: {
                type: 'boolean',
                default: false,
                description: 'When true, PandaDoc skips the recipient email and just marks the document as sent.',
              },
            },
            required: ['documentId'],
          },
        },
        {
          name: 'cancel_document',
          class: 'mutation',
          description:
            'Cancel/void an in-flight PandaDoc document. Idempotent at the upstream — re-cancelling returns idempotentReplay=true.',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              documentId: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['documentId'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = await ensureFreshAccessToken(inv, clientId, clientSecret)
      if (inv.capabilityName === 'search_documents') return searchDocuments(inv, accessToken, baseUrl, timeoutMs)
      if (inv.capabilityName === 'get_document') return getDocument(inv, accessToken, baseUrl, timeoutMs)
      throw new Error(`pandadoc: unknown read capability ${inv.capabilityName}`)
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const accessToken = await ensureFreshAccessToken(inv, clientId, clientSecret)
      if (inv.capabilityName === 'create_document') return createDocument(inv, accessToken, baseUrl, timeoutMs)
      if (inv.capabilityName === 'send_document') return sendDocument(inv, accessToken, baseUrl, timeoutMs)
      if (inv.capabilityName === 'cancel_document') return cancelDocument(inv, accessToken, baseUrl, timeoutMs)
      throw new Error(`pandadoc: unknown mutation capability ${inv.capabilityName}`)
    },

    async exchangeOAuth(input) {
      if (!clientId || !clientSecret) {
        throw new Error('PandaDoc OAuth client not configured (PANDADOC_OAUTH_CLIENT_ID / _SECRET)')
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
        throw new Error('pandadoc.refreshToken: missing refresh token')
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
        const accessToken = await ensureFreshAccessTokenFromCreds(source.credentials, clientId, clientSecret)
        // GET /documents?count=1 is the cheapest grant-validity probe — it
        // exercises both the scope check (read) and the API host.
        const res = await fetch(`${baseUrl}/documents?count=1`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: `PandaDoc rejected token (${res.status}) — reconnect required` }
        }
        if (!res.ok) return { ok: false, reason: `PandaDoc returned ${res.status}` }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
  return adapter
}

interface PandaDocDocumentSummary {
  id: string
  name: string
  status?: string
  date_created?: string
  date_modified?: string
  expiration_date?: string | null
  version?: string
  template_uuid?: string | null
  metadata?: Record<string, unknown>
}

interface PandaDocDocumentDetail extends PandaDocDocumentSummary {
  date_completed?: string | null
  recipients?: Array<{
    id?: string
    email: string
    first_name?: string
    last_name?: string
    role?: string
    signing_order?: number
    has_completed?: boolean
  }>
  tokens?: Array<{ name: string; value: string }>
  fields?: Array<{ uuid?: string; name?: string; value?: unknown; assigned_to?: unknown }>
  pricing?: unknown
}

function normalizeSummary(d: PandaDocDocumentSummary): Record<string, unknown> {
  return {
    documentId: d.id,
    name: d.name,
    status: d.status ?? 'document.draft',
    dateCreated: d.date_created,
    dateModified: d.date_modified,
    expirationDate: d.expiration_date ?? undefined,
    templateId: d.template_uuid ?? undefined,
    metadata: d.metadata,
  }
}

function normalizeDetail(d: PandaDocDocumentDetail): Record<string, unknown> {
  return {
    ...normalizeSummary(d),
    dateCompleted: d.date_completed ?? undefined,
    recipients: (d.recipients ?? []).map((r) => ({
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      role: r.role,
      signingOrder: r.signing_order,
      hasCompleted: r.has_completed ?? false,
    })),
    tokens: d.tokens ?? [],
    fields: d.fields ?? [],
    pricing: d.pricing,
  }
}

async function searchDocuments(
  inv: ConnectorInvocation,
  accessToken: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { query, status, templateId, limit } = inv.args as {
    query?: string
    status?: string
    templateId?: string
    limit?: number
  }
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (status) params.set('status', status)
  if (templateId) params.set('template_id', templateId)
  params.set('count', String(Math.min(Math.max(limit ?? 25, 1), 100)))
  const res = await fetch(`${baseUrl}/documents?${params.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) throw new CredentialsExpired('PandaDoc rejected token (401)', inv.source.id)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`pandadoc search_documents ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { results?: PandaDocDocumentSummary[] }
  return {
    data: {
      documents: (json.results ?? []).map(normalizeSummary),
      more: (json.results ?? []).length >= Math.min(Math.max(limit ?? 25, 1), 100),
    },
    fetchedAt: Date.now(),
  }
}

async function getDocument(
  inv: ConnectorInvocation,
  accessToken: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { documentId } = inv.args as { documentId: string }
  const res = await fetch(`${baseUrl}/documents/${encodeURIComponent(documentId)}/details`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) throw new CredentialsExpired('PandaDoc rejected token (401)', inv.source.id)
  if (res.status === 404) {
    throw new Error(`pandadoc get_document: document ${documentId} not found`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`pandadoc get_document ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as PandaDocDocumentDetail
  return {
    data: normalizeDetail(json),
    etag: json.date_modified,
    fetchedAt: Date.now(),
  }
}

async function createDocument(
  inv: ConnectorInvocation,
  accessToken: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { name, templateId, recipients, tokens, fields, pricingTables, metadata, tags } = inv.args as {
    name: string
    templateId: string
    recipients: Array<{
      email: string
      firstName?: string
      lastName?: string
      role?: string
      signingOrder?: number
    }>
    tokens?: Array<{ name: string; value: string }>
    fields?: Record<string, Record<string, unknown>>
    pricingTables?: unknown[]
    metadata?: Record<string, unknown>
    tags?: string[]
  }
  // Idempotency fingerprint — see file header. We list-search by this
  // metadata key before issuing the POST so a retry that completed
  // upstream surfaces as an idempotent replay.
  const fingerprintKey = 'tangleIdempotencyKey'
  const fingerprint = inv.idempotencyKey
  const replay = await findByFingerprint(accessToken, baseUrl, timeoutMs, fingerprintKey, fingerprint)
  if (replay) {
    return {
      status: 'committed',
      data: normalizeSummary(replay),
      etagAfter: replay.date_modified,
      committedAt: Date.now(),
      idempotentReplay: true,
    }
  }
  const body = {
    name,
    template_uuid: templateId,
    recipients: recipients.map((r) => ({
      email: r.email,
      first_name: r.firstName,
      last_name: r.lastName,
      role: r.role,
      signing_order: r.signingOrder,
    })),
    tokens: tokens ?? [],
    fields: fields ?? {},
    pricing_tables: pricingTables ?? [],
    metadata: { ...(metadata ?? {}), [fingerprintKey]: fingerprint },
    tags: tags ?? [],
  }
  const res = await fetch(`${baseUrl}/documents`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) throw new CredentialsExpired('PandaDoc rejected token (401)', inv.source.id)
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '5')
    return {
      status: 'rate-limited',
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 5_000,
      message: 'PandaDoc rate-limited create_document',
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`pandadoc create_document ${res.status}: ${text.slice(0, 200)}`)
  }
  const created = (await res.json()) as PandaDocDocumentSummary
  return {
    status: 'committed',
    data: normalizeSummary(created),
    etagAfter: created.date_modified,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function findByFingerprint(
  accessToken: string,
  baseUrl: string,
  timeoutMs: number,
  key: string,
  fingerprint: string,
): Promise<PandaDocDocumentSummary | null> {
  // PandaDoc supports filtering by metadata via `metadata_<key>=<value>`
  // query parameters on the list endpoint.
  const params = new URLSearchParams()
  params.set(`metadata_${key}`, fingerprint)
  params.set('count', '1')
  const res = await fetch(`${baseUrl}/documents?${params.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) return null
  const json = (await res.json().catch(() => ({}))) as { results?: PandaDocDocumentSummary[] }
  return json.results?.[0] ?? null
}

async function sendDocument(
  inv: ConnectorInvocation,
  accessToken: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { documentId, subject, message, sender, silent } = inv.args as {
    documentId: string
    subject?: string
    message?: string
    sender?: { email?: string; firstName?: string; lastName?: string }
    silent?: boolean
  }
  const body: Record<string, unknown> = {
    silent: silent ?? false,
  }
  if (subject) body.subject = subject
  if (message) body.message = message
  if (sender) {
    body.sender = {
      email: sender.email,
      first_name: sender.firstName,
      last_name: sender.lastName,
    }
  }
  const res = await fetch(`${baseUrl}/documents/${encodeURIComponent(documentId)}/send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) throw new CredentialsExpired('PandaDoc rejected token (401)', inv.source.id)
  if (res.status === 404) {
    throw new Error(`pandadoc send_document: document ${documentId} not found`)
  }
  if (res.status === 400 || res.status === 409) {
    const text = await res.text().catch(() => '')
    if (/already.*sent|invalid.*state|transition/i.test(text)) {
      throw new ResourceContention(`pandadoc send_document: document ${documentId} is not in a sendable state`)
    }
    throw new Error(`pandadoc send_document ${res.status}: ${text.slice(0, 200)}`)
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '5')
    return {
      status: 'rate-limited',
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 5_000,
      message: 'PandaDoc rate-limited send_document',
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`pandadoc send_document ${res.status}: ${text.slice(0, 200)}`)
  }
  const sent = (await res.json().catch(() => ({}))) as PandaDocDocumentSummary
  return {
    status: 'committed',
    data: {
      documentId,
      status: sent.status ?? 'document.sent',
      dateModified: sent.date_modified,
    },
    etagAfter: sent.date_modified,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function cancelDocument(
  inv: ConnectorInvocation,
  accessToken: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { documentId, reason } = inv.args as { documentId: string; reason?: string }
  const res = await fetch(`${baseUrl}/documents/${encodeURIComponent(documentId)}/cancel`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ reason: reason ?? 'Cancelled by Tangle agent' }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) throw new CredentialsExpired('PandaDoc rejected token (401)', inv.source.id)
  if (res.status === 404) {
    throw new Error(`pandadoc cancel_document: document ${documentId} not found`)
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '5')
    return {
      status: 'rate-limited',
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 5_000,
      message: 'PandaDoc rate-limited cancel_document',
    }
  }
  if (res.status === 400 || res.status === 409) {
    // PandaDoc returns 400 with status="document.voided" body when the
    // document is already voided — surface as an idempotent replay
    // rather than an error.
    const text = await res.text().catch(() => '')
    if (/already.*void|already.*cancel/i.test(text)) {
      return {
        status: 'committed',
        data: { documentId, status: 'document.voided', voidedAt: new Date().toISOString() },
        committedAt: Date.now(),
        idempotentReplay: true,
      }
    }
    throw new Error(`pandadoc cancel_document ${res.status}: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`pandadoc cancel_document ${res.status}: ${text.slice(0, 200)}`)
  }
  const voided = (await res.json().catch(() => ({}))) as PandaDocDocumentSummary
  return {
    status: 'committed',
    data: {
      documentId,
      status: voided.status ?? 'document.voided',
      voidedAt: voided.date_modified ?? new Date().toISOString(),
    },
    etagAfter: voided.date_modified,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function ensureFreshAccessToken(
  inv: ConnectorInvocation,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const creds = inv.source.credentials
  return ensureFreshAccessTokenFromCreds(creds, clientId, clientSecret, inv.onCredentialsRotated)
}

async function ensureFreshAccessTokenFromCreds(
  creds: ConnectorCredentials,
  clientId: string,
  clientSecret: string,
  onCredentialsRotated?: (next: ConnectorCredentials) => void,
): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('pandadoc: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('PandaDoc access token expired and no refresh token', '')
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
  if (onCredentialsRotated) {
    onCredentialsRotated({
      kind: 'oauth2',
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
    })
  }
  return creds.accessToken
}
