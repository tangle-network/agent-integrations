/**
 * @stable Dropbox Sign (formerly HelloSign) connector — e-signature flows
 * powered by reusable templates.
 *
 * Three capabilities + inbound webhook surface, modeled on Dropbox Sign's
 * /v3/signature_request endpoints:
 *
 *   send_signature_request(templateIds, signers, subject?, message?, testMode?)
 *     → {signatureRequestId, signatureUrlsBySigner?, isComplete:false, signers:[...]}
 *     Mutation. POST /signature_request/send_with_template. The Dropbox Sign
 *     API exposes neither an `idempotency_key` field nor an external_id on
 *     this endpoint, so we encode a one-way fingerprint of the
 *     idempotencyKey in the `metadata.tangle_idempotency_key` field and
 *     refuse to retry until the SDK's MutationGuard has a record. CAS =
 *     native-idempotency only because retry-on-network-error is gated by
 *     MutationGuard's idempotency-key short-circuit; we do NOT trust
 *     Dropbox Sign to dedupe.
 *
 *   get_signature_request(signatureRequestId)
 *     → {signatureRequestId, isComplete, isCanceled, signers:[{email, name, status, signedAt?, lastReminderedAt?}]}
 *     Read. GET /signature_request/:id.
 *
 *   cancel_signature_request(signatureRequestId)
 *     → {signatureRequestId, status: 'canceled', canceledAt}
 *     Mutation. POST /signature_request/cancel/:id. Idempotent by design —
 *     Dropbox Sign returns 200 even if the request is already canceled, so
 *     we surface `idempotentReplay: true` on the second call.
 *
 *   handleInboundEvent (webhook surface)
 *     Dropbox Sign POSTs JSON to a customer-configured URL with the body
 *     under a `json` form-field (multipart/form-data) OR as a plain JSON
 *     body for newer apps. The payload carries `event.event_hash` which is
 *     `HMAC_SHA256(api_key, event_time + event_type)` (hex). We verify by
 *     recomputing the hash and comparing in constant time. There is no
 *     dedicated signature header; the signature lives inside the body.
 *
 * Auth: OAuth2 (Dropbox Sign authorizes per-account access tokens). Every
 * API endpoint accepts the access token via `Authorization: Bearer <token>`.
 * The same access token doubles as the HMAC key for webhook verification
 * because Dropbox Sign reuses the API credential — we lift it from the
 * resolved OAuth credentials envelope, never from env.
 *
 * Error taxonomy (mapped via integrations/errors.ts):
 *   401 → provider_auth_failed (CredentialsExpired) — refresh attempted once
 *   404 → action_not_found (Error) — signature_request_id is unknown
 *   409 → action_denied / ResourceContention when status guards (e.g.
 *          cancel of a completed request)
 *   429 → provider_rate_limited (status: 'rate-limited' result)
 *   5xx → provider_unavailable
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type ConnectorCredentials,
  type EventHandlerResult,
  type InboundEvent,
  ResourceContention,
  CredentialsExpired,
} from '../types.js'
import { exchangeAuthorizationCode, refreshAccessToken } from '../oauth.js'

const SCOPES = [
  'basic_account_info',
  'request_signature',
  'signature_request_access',
]
const AUTH_URL = 'https://app.hellosign.com/oauth/authorize'
const TOKEN_URL = 'https://app.hellosign.com/oauth/token'
const DEFAULT_API_BASE = 'https://api.hellosign.com/v3'

/** OAuth client config the factory closes over. Caller resolves these at
 *  construction time (env, DB, secret manager — package doesn't care). */
export interface HelloSignOptions {
  clientId: string
  clientSecret: string
  /** Override the Dropbox Sign API base URL. Mainly for tests + EU residency. */
  baseUrl?: string
  /** Default request timeout in ms. */
  timeoutMs?: number
}

export function hellosign(opts: HelloSignOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const baseUrl = (opts.baseUrl ?? DEFAULT_API_BASE).replace(/\/$/, '')
  const timeoutMs = opts.timeoutMs ?? 30_000
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'hellosign',
      displayName: 'Dropbox Sign',
      description:
        "Send documents for e-signature via Dropbox Sign templates, poll signature-request status, cancel in-flight requests, and react to push events when signers complete.",
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes: SCOPES,
        clientIdEnv: 'HELLOSIGN_OAUTH_CLIENT_ID',
        clientSecretEnv: 'HELLOSIGN_OAUTH_CLIENT_SECRET',
        // Dropbox Sign rejects a per-request `scope` param ("Custom scopes
        // are not supported yet") — scopes are pinned in the API app
        // settings, so the authorization URL must omit scope.
        sendScopeParam: false,
      },
      category: 'doc',
      defaultConsistencyModel: 'authoritative',
      capabilities: [
        {
          name: 'get_signature_request',
          class: 'read',
          description: 'Fetch the current status of a Dropbox Sign signature request and each signer.',
          parameters: {
            type: 'object',
            properties: { signatureRequestId: { type: 'string' } },
            required: ['signatureRequestId'],
          },
          requiredScopes: ['signature_request_access'],
        },
        {
          name: 'send_signature_request',
          class: 'mutation',
          description:
            'Send a template for signature to one or more signers. The MutationGuard idempotency-key short-circuit prevents duplicate sends on retry; tangle_idempotency_key is also written into metadata for forensic dedup.',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              templateIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'One or more Dropbox Sign template ids to compose into the signature request.',
              },
              signers: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    role: { type: 'string', description: 'Template role name as configured in Dropbox Sign.' },
                    email: { type: 'string' },
                    name: { type: 'string' },
                  },
                  required: ['role', 'email', 'name'],
                },
              },
              subject: { type: 'string' },
              message: { type: 'string' },
              testMode: { type: 'boolean', description: 'When true, no real signature is collected.' },
              customFields: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    value: { type: 'string' },
                  },
                  required: ['name', 'value'],
                },
              },
            },
            required: ['templateIds', 'signers'],
          },
          requiredScopes: ['request_signature'],
        },
        {
          name: 'cancel_signature_request',
          class: 'mutation',
          description:
            'Cancel an in-flight signature request. Idempotent — a second cancel of an already-canceled request returns committed with idempotentReplay=true.',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: { signatureRequestId: { type: 'string' } },
            required: ['signatureRequestId'],
          },
          requiredScopes: ['request_signature'],
        },
        {
          name: 'remind_signature_request',
          class: 'mutation',
          description:
            'Send a reminder email to a signer who has not yet signed. POST /signature_request/remind/:id with the signer email address; safe to retry — Dropbox Sign rate-limits reminders per signer per request, so a duplicate reminder is a no-op on its end.',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              signatureRequestId: { type: 'string' },
              emailAddress: {
                type: 'string',
                description: 'Email address of the signer to remind.',
              },
              name: {
                type: 'string',
                description: 'Optional display name of the signer (must match the original signer name on multi-signer requests).',
              },
            },
            required: ['signatureRequestId', 'emailAddress'],
          },
          requiredScopes: ['request_signature'],
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      if (inv.capabilityName !== 'get_signature_request') {
        throw new Error(`hellosign: unknown read capability ${inv.capabilityName}`)
      }
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret, inv)
      const { signatureRequestId } = inv.args as { signatureRequestId: string }
      const res = await fetch(`${baseUrl}/signature_request/${encodeURIComponent(signatureRequestId)}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 401) {
        throw new CredentialsExpired('Dropbox Sign rejected token (401)', inv.source.id)
      }
      if (res.status === 404) {
        throw new Error(`hellosign get_signature_request: signature request ${signatureRequestId} not found`)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`hellosign get_signature_request ${res.status}: ${text.slice(0, 200)}`)
      }
      const json = (await res.json()) as { signature_request?: HelloSignSignatureRequest }
      const sr = json.signature_request
      if (!sr) {
        throw new Error('hellosign get_signature_request: empty response body')
      }
      return {
        data: normalizeSignatureRequest(sr),
        fetchedAt: Date.now(),
      }
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret, inv)
      if (inv.capabilityName === 'send_signature_request') {
        return sendSignatureRequest(inv, accessToken, baseUrl, timeoutMs)
      }
      if (inv.capabilityName === 'cancel_signature_request') {
        return cancelSignatureRequest(inv, accessToken, baseUrl, timeoutMs)
      }
      if (inv.capabilityName === 'remind_signature_request') {
        return remindSignatureRequest(inv, accessToken, baseUrl, timeoutMs)
      }
      throw new Error(`hellosign: unknown mutation capability ${inv.capabilityName}`)
    },

    async exchangeOAuth(input) {
      if (!clientId || !clientSecret) {
        throw new Error('Dropbox Sign OAuth client not configured (HELLOSIGN_OAUTH_CLIENT_ID / _SECRET)')
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
        throw new Error('hellosign.refreshToken: missing refresh token')
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

    verifySignature({ rawBody, source }) {
      if (source.credentials.kind !== 'oauth2' || !source.credentials.accessToken) {
        return { valid: false, reason: 'missing_credentials' }
      }
      const parsed = parseInboundBody(rawBody)
      if (!parsed) return { valid: false, reason: 'invalid_payload' }
      const { event } = parsed
      if (!event || typeof event.event_time !== 'string' || typeof event.event_type !== 'string' || typeof event.event_hash !== 'string') {
        return { valid: false, reason: 'missing_event_fields' }
      }
      const expected = createHmac('sha256', source.credentials.accessToken)
        .update(`${event.event_time}${event.event_type}`)
        .digest('hex')
      const a = Buffer.from(event.event_hash.toLowerCase(), 'utf-8')
      const b = Buffer.from(expected.toLowerCase(), 'utf-8')
      if (a.length !== b.length) return { valid: false, reason: 'invalid_signature' }
      return timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'invalid_signature' }
    },

    async handleInboundEvent({ rawBody }): Promise<EventHandlerResult> {
      const parsed = parseInboundBody(rawBody)
      if (!parsed) {
        return { events: [], response: { status: 400, body: { error: 'invalid_payload' } } }
      }
      const evt = parsed.event ?? {}
      const eventType = typeof evt.event_type === 'string' ? `hellosign.${evt.event_type}` : 'hellosign.unknown'
      const providerEventId = typeof evt.event_id === 'string'
        ? evt.event_id
        : typeof evt.event_time === 'string' && typeof evt.event_type === 'string'
          ? `${evt.event_type}:${evt.event_time}`
          : undefined
      const events: InboundEvent[] = [
        {
          eventType,
          providerEventId,
          payload: parsed as unknown as Record<string, unknown>,
        },
      ]
      // Dropbox Sign requires the literal body 'Hello API Event Received' to
      // confirm receipt, otherwise it keeps retrying the same event.
      return {
        events,
        response: {
          status: 200,
          body: 'Hello API Event Received',
          headers: { 'content-type': 'text/plain' },
        },
      }
    },

    async test(source) {
      try {
        const accessToken = await ensureFreshAccessToken(source.credentials, clientId, clientSecret)
        const res = await fetch(`${baseUrl}/account`, {
          headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: `Dropbox Sign rejected token (${res.status}) — reconnect required` }
        }
        if (!res.ok) return { ok: false, reason: `Dropbox Sign returned ${res.status}` }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
  return adapter
}

interface HelloSignSigner {
  signature_id?: string
  name?: string
  email_address?: string
  role?: string
  order?: number
  status_code?: string
  signed_at?: number | null
  last_viewed_at?: number | null
  last_reminded_at?: number | null
  sign_url?: string | null
}

interface HelloSignSignatureRequest {
  signature_request_id: string
  test_mode?: boolean
  title?: string
  subject?: string
  message?: string
  is_complete?: boolean
  is_declined?: boolean
  has_error?: boolean
  custom_fields?: Array<{ name: string; type: string; value?: string; required?: boolean }>
  metadata?: Record<string, unknown>
  created_at?: number
  details_url?: string
  signing_url?: string | null
  signatures?: HelloSignSigner[]
  // present on cancel responses
  canceled_at?: number
}

interface HelloSignInboundBody {
  event?: {
    event_time?: string
    event_type?: string
    event_hash?: string
    event_id?: string
    event_metadata?: Record<string, unknown>
  }
  signature_request?: HelloSignSignatureRequest
  account?: Record<string, unknown>
}

function normalizeSignatureRequest(sr: HelloSignSignatureRequest): Record<string, unknown> {
  return {
    signatureRequestId: sr.signature_request_id,
    title: sr.title,
    subject: sr.subject,
    message: sr.message,
    testMode: sr.test_mode === true,
    isComplete: sr.is_complete === true,
    isDeclined: sr.is_declined === true,
    hasError: sr.has_error === true,
    createdAt: typeof sr.created_at === 'number' ? sr.created_at : undefined,
    detailsUrl: sr.details_url,
    customFields: (sr.custom_fields ?? []).map((cf) => ({
      name: cf.name,
      type: cf.type,
      value: cf.value,
      required: cf.required === true,
    })),
    signers: (sr.signatures ?? []).map((s) => ({
      signatureId: s.signature_id,
      email: s.email_address,
      name: s.name,
      role: s.role,
      order: s.order,
      status: s.status_code ?? 'awaiting_signature',
      signedAt: typeof s.signed_at === 'number' ? s.signed_at : undefined,
      lastViewedAt: typeof s.last_viewed_at === 'number' ? s.last_viewed_at : undefined,
      lastRemindedAt: typeof s.last_reminded_at === 'number' ? s.last_reminded_at : undefined,
      signUrl: s.sign_url ?? undefined,
    })),
  }
}

async function sendSignatureRequest(
  inv: ConnectorInvocation,
  accessToken: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { templateIds, signers, subject, message, testMode, customFields } = inv.args as {
    templateIds: string[]
    signers: Array<{ role: string; email: string; name: string }>
    subject?: string
    message?: string
    testMode?: boolean
    customFields?: Array<{ name: string; value: string }>
  }
  if (!Array.isArray(templateIds) || templateIds.length === 0) {
    throw new Error('hellosign send_signature_request: templateIds must be a non-empty array')
  }
  if (!Array.isArray(signers) || signers.length === 0) {
    throw new Error('hellosign send_signature_request: signers must be a non-empty array')
  }
  // Dropbox Sign's send_with_template accepts either form-encoded or JSON.
  // JSON is simpler for nested arrays.
  const body: Record<string, unknown> = {
    template_ids: templateIds,
    subject,
    message,
    test_mode: testMode === true ? 1 : 0,
    signers: signers.map((s) => ({ role: s.role, email_address: s.email, name: s.name })),
    metadata: { tangle_idempotency_key: inv.idempotencyKey },
  }
  if (customFields && customFields.length > 0) {
    body.custom_fields = customFields.map((cf) => ({ name: cf.name, value: cf.value }))
  }
  const res = await fetch(`${baseUrl}/signature_request/send_with_template`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('Dropbox Sign rejected token (401)', inv.source.id)
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '5')
    return {
      status: 'rate-limited',
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 5_000,
      message: 'Dropbox Sign rate-limited send_signature_request',
    }
  }
  if (res.status === 409) {
    // Dropbox Sign uses 409 for "template requires fields not provided".
    const text = await res.text().catch(() => '')
    throw new ResourceContention(`hellosign send_signature_request conflict: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hellosign send_signature_request ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { signature_request?: HelloSignSignatureRequest }
  const sr = json.signature_request
  if (!sr) {
    throw new Error('hellosign send_signature_request: empty response body')
  }
  return {
    status: 'committed',
    data: normalizeSignatureRequest(sr),
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function cancelSignatureRequest(
  inv: ConnectorInvocation,
  accessToken: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { signatureRequestId } = inv.args as { signatureRequestId: string }
  const res = await fetch(`${baseUrl}/signature_request/cancel/${encodeURIComponent(signatureRequestId)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('Dropbox Sign rejected token (401)', inv.source.id)
  }
  if (res.status === 404) {
    throw new Error(`hellosign cancel_signature_request: signature request ${signatureRequestId} not found`)
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '5')
    return {
      status: 'rate-limited',
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 5_000,
      message: 'Dropbox Sign rate-limited cancel_signature_request',
    }
  }
  // Dropbox Sign returns 200 with empty body on both first cancel and
  // already-canceled. A 409 fires when the request is fully complete
  // (cannot cancel a signed request).
  if (res.status === 409) {
    throw new ResourceContention(`hellosign cancel_signature_request: request ${signatureRequestId} is already completed`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hellosign cancel_signature_request ${res.status}: ${text.slice(0, 200)}`)
  }
  return {
    status: 'committed',
    data: {
      signatureRequestId,
      status: 'canceled',
      canceledAt: new Date().toISOString(),
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function remindSignatureRequest(
  inv: ConnectorInvocation,
  accessToken: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { signatureRequestId, emailAddress, name } = inv.args as {
    signatureRequestId: string
    emailAddress: string
    name?: string
  }
  if (typeof signatureRequestId !== 'string' || signatureRequestId.length === 0) {
    throw new Error('hellosign remind_signature_request: signatureRequestId is required')
  }
  if (typeof emailAddress !== 'string' || emailAddress.length === 0) {
    throw new Error('hellosign remind_signature_request: emailAddress is required')
  }
  const body: Record<string, unknown> = { email_address: emailAddress }
  if (name) body.name = name
  const res = await fetch(`${baseUrl}/signature_request/remind/${encodeURIComponent(signatureRequestId)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('Dropbox Sign rejected token (401)', inv.source.id)
  }
  if (res.status === 404) {
    throw new Error(`hellosign remind_signature_request: signature request ${signatureRequestId} not found`)
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '5')
    return {
      status: 'rate-limited',
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 5_000,
      message: 'Dropbox Sign rate-limited remind_signature_request',
    }
  }
  if (res.status === 409) {
    // Dropbox Sign returns 409 when the request is already complete or the
    // signer has already signed — surface as ResourceContention so callers
    // can branch on the state rather than treat as a transport failure.
    const text = await res.text().catch(() => '')
    throw new ResourceContention(`hellosign remind_signature_request: cannot remind — ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hellosign remind_signature_request ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json().catch(() => ({}))) as { signature_request?: HelloSignSignatureRequest }
  const sr = json.signature_request
  return {
    status: 'committed',
    data: sr
      ? normalizeSignatureRequest(sr)
      : { signatureRequestId, remindedEmail: emailAddress, remindedAt: new Date().toISOString() },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

/**
 * Dropbox Sign posts callbacks either as `application/json` or as
 * `multipart/form-data` with a `json` field. We accept both: try JSON
 * first, fall back to extracting a `json=` segment from the raw body.
 */
function parseInboundBody(rawBody: string): HelloSignInboundBody | null {
  try {
    const json = JSON.parse(rawBody) as HelloSignInboundBody
    if (json && typeof json === 'object') return json
  } catch {
    // fall through to form-data extraction
  }
  // crude multipart extraction: look for a `json=` value (form-urlencoded
  // fallback some Dropbox Sign apps still emit)
  const match = /(?:^|&)json=([^&]+)/.exec(rawBody)
  if (match) {
    try {
      return JSON.parse(decodeURIComponent(match[1])) as HelloSignInboundBody
    } catch {
      return null
    }
  }
  // multipart/form-data with a `name="json"` part
  const partMatch = /name="json"[^]*?\r?\n\r?\n([\s\S]*?)\r?\n--/m.exec(rawBody)
  if (partMatch) {
    try {
      return JSON.parse(partMatch[1]) as HelloSignInboundBody
    } catch {
      return null
    }
  }
  return null
}

async function ensureFreshAccessToken(
  creds: ConnectorCredentials,
  clientId: string,
  clientSecret: string,
  inv?: ConnectorInvocation,
): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('hellosign: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Dropbox Sign access token expired and no refresh token', inv?.source.id ?? '')
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
  inv?.onCredentialsRotated?.({
    kind: 'oauth2',
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt,
  })
  return creds.accessToken
}
