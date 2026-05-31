/**
 * Google Forms connector — read a form's schema + paginate its responses.
 *
 * Two-pane surface aimed at the dominant agent workflow ("ingest this
 * survey into the KB / route this lead based on the response that just
 * came in"):
 *
 *   get_form(formId)
 *     → {formId, info: {title, description, documentTitle}, items: [...],
 *        revisionId, responderUri}
 *     Read. GET /v1/forms/{formId}. The full Form resource, including the
 *     item tree (questions, sections, page breaks). The agent layer uses
 *     `items[]` to map raw response answers back to human-readable
 *     questions; the alternative is hand-rolling the questionId→title
 *     join every call. Includes `revisionId` so callers can detect a
 *     schema change since the last ingest.
 *
 *   list_responses(formId, pageSize?, pageToken?, filter?)
 *     → {responses: [{responseId, createTime, lastSubmittedTime,
 *        respondentEmail?, answers: {questionId: {value: string[]}}}],
 *        nextPageToken?}
 *     Read. GET /v1/forms/{formId}/responses. Forms paginates with
 *     pageToken/pageSize (max 5000 per Forms API docs). The optional
 *     `filter` accepts the Forms `timestamp` filter grammar
 *     (e.g. `timestamp > "2026-01-01T00:00:00Z"`) so incremental ingest
 *     just needs to track the last-seen submission time. We collapse
 *     each answer's `textAnswers.answers[].value` array into a single
 *     `value: string[]` field — Forms nests responses three levels deep
 *     (answers → textAnswers → answers[] → value); the original tree is
 *     preserved at `raw` for callers that need fileUploadAnswers,
 *     grade, etc.
 *
 *   get_response(formId, responseId)
 *     → single-response variant of list_responses for webhook delivery
 *     where the watch notification carries only the responseId.
 *     Read. GET /v1/forms/{formId}/responses/{responseId}.
 *
 * Auth: OAuth2. We request `forms.body.readonly` for the schema and
 * `forms.responses.readonly` for the submissions — both are
 * non-sensitive read scopes that don't trigger Google's restricted-scope
 * verification flow. We deliberately do NOT request `forms.body` (write):
 * creating/mutating a form is a separate connector surface and would
 * upgrade this connector to a restricted scope, which forces the
 * customer's OAuth app through a security review.
 *
 * Why no `create_form` / `submit_response`:
 *   - create_form requires the sensitive `forms.body` scope; out of
 *     scope for an ingest connector.
 *   - submit_response: the Forms API has no public endpoint for
 *     programmatic submission; the only path is the public form URL
 *     (formResponse), which the connector framework treats as a
 *     generic webhook, not a Forms-API capability.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type ConnectorCredentials,
  CredentialsExpired,
} from '../types.js'
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '../oauth.js'

const SCOPES = [
  'https://www.googleapis.com/auth/forms.body.readonly',
  'https://www.googleapis.com/auth/forms.responses.readonly',
]
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://forms.googleapis.com/v1'

/** OAuth client config the factory closes over. */
export interface GoogleFormsOptions {
  clientId: string
  clientSecret: string
  /** Default request timeout in ms. Applied per-fetch via AbortSignal. */
  timeoutMs?: number
}

export function googleForms(opts: GoogleFormsOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const timeoutMs = opts.timeoutMs ?? 30_000

  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'google-forms',
      displayName: 'Google Forms',
      description:
        "Read a Google Form's schema and paginate its responses for KB ingest, lead routing, or analytics. Returns answers keyed by questionId with the original item tree available for question→title joins.",
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
      category: 'other',
      defaultConsistencyModel: 'cache',
      // Forms API doesn't publish a hard QPM, but Google's default
      // per-user quota across the v1 surface is 300 read req/min. Meter
      // OAuth-client-wide so a chatty tenant can't burn the shared
      // bucket.
      rateLimit: { requests: 300, windowMs: 60_000, scope: 'oauth-client' },
      capabilities: [
        {
          name: 'get_form',
          class: 'read',
          description:
            'Fetch the full Form resource by id. Returns info (title/description), the item tree (questions + sections), the current revisionId, and the public responderUri. Use the item tree to map answer questionIds back to human-readable question titles.',
          parameters: {
            type: 'object',
            properties: {
              formId: {
                type: 'string',
                description: 'Forms form id (the slug after /forms/d/ in the editor URL).',
              },
            },
            required: ['formId'],
          },
        },
        {
          name: 'list_responses',
          class: 'read',
          description:
            'List form responses with pagination. `filter` accepts the Forms timestamp grammar (e.g. `timestamp > "2026-01-01T00:00:00Z"`) for incremental ingest. Each response carries flattened `answers: {questionId: {value: string[]}}` plus the original payload at `raw`.',
          parameters: {
            type: 'object',
            properties: {
              formId: { type: 'string' },
              pageSize: {
                type: 'integer',
                minimum: 1,
                maximum: 5000,
                default: 100,
                description: 'Max responses to return in this page. Forms API caps at 5000.',
              },
              pageToken: {
                type: 'string',
                description: 'nextPageToken from a prior call to continue the same page sequence.',
              },
              filter: {
                type: 'string',
                description: 'Optional Forms responses filter (timestamp grammar).',
              },
            },
            required: ['formId'],
          },
        },
        {
          name: 'get_response',
          class: 'read',
          description:
            'Fetch a single response by id — the common path when a Forms watch notification delivers only the responseId.',
          parameters: {
            type: 'object',
            properties: {
              formId: { type: 'string' },
              responseId: { type: 'string' },
            },
            required: ['formId', 'responseId'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
      if (inv.capabilityName === 'get_form') return getForm(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'list_responses') return listResponses(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'get_response') return getResponse(inv, accessToken, timeoutMs)
      throw new Error(`google-forms: unknown read capability ${inv.capabilityName}`)
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
        throw new Error('google-forms.refreshToken: missing refresh token')
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
        // Forms API has no /me probe and rejects unauthenticated form
        // lookups uniformly with 404, so we validate the access token
        // against the OIDC userinfo endpoint — cheapest auth proof that
        // doesn't require knowing a formId.
        const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: `Google rejected Forms token (${res.status}) — reconnect required` }
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

interface FormsTextAnswer {
  value?: string
}
interface FormsTextAnswers {
  answers?: FormsTextAnswer[]
}
interface FormsAnswer {
  questionId?: string
  textAnswers?: FormsTextAnswers
}
interface FormsResponse {
  responseId: string
  createTime?: string
  lastSubmittedTime?: string
  respondentEmail?: string
  answers?: Record<string, FormsAnswer>
}
interface FormsListResponsesEnvelope {
  responses?: FormsResponse[]
  nextPageToken?: string
}
interface FormsForm {
  formId: string
  revisionId?: string
  responderUri?: string
  info?: { title?: string; description?: string; documentTitle?: string }
  items?: unknown[]
}

/** Flatten Forms' three-level `answers[questionId].textAnswers.answers[].value`
 *  tree into a simple `{questionId: {value: string[]}}` map. Multi-select
 *  questions emit one entry per choice; single-select questions emit one
 *  entry. The original payload is preserved on `raw` so callers that need
 *  fileUploadAnswers / grade / questionGroupAnswers can still reach them. */
function flattenAnswers(answers: Record<string, FormsAnswer> | undefined): Record<string, { value: string[] }> {
  const out: Record<string, { value: string[] }> = {}
  if (!answers) return out
  for (const [questionId, ans] of Object.entries(answers)) {
    const values: string[] = []
    for (const a of ans.textAnswers?.answers ?? []) {
      if (typeof a.value === 'string') values.push(a.value)
    }
    out[questionId] = { value: values }
  }
  return out
}

async function getForm(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { formId } = (inv.args ?? {}) as { formId: string }
  if (!formId) throw new Error('google-forms get_form: formId is required')
  const res = await fetch(`${API}/forms/${encodeURIComponent(formId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Forms rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 404) {
    throw new Error(`google-forms get_form: form ${formId} not found`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-forms get_form ${res.status}: ${text.slice(0, 200)}`)
  }
  const form = (await res.json()) as FormsForm
  return {
    data: {
      formId: form.formId,
      info: form.info ?? {},
      items: form.items ?? [],
      revisionId: form.revisionId,
      responderUri: form.responderUri,
    },
    etag: form.revisionId,
    fetchedAt: Date.now(),
  }
}

async function listResponses(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { formId, pageSize, pageToken, filter } = (inv.args ?? {}) as {
    formId: string
    pageSize?: number
    pageToken?: string
    filter?: string
  }
  if (!formId) throw new Error('google-forms list_responses: formId is required')

  const params = new URLSearchParams()
  if (typeof pageSize === 'number') params.set('pageSize', String(pageSize))
  if (pageToken) params.set('pageToken', pageToken)
  if (filter) params.set('filter', filter)
  const qs = params.toString()
  const url = `${API}/forms/${encodeURIComponent(formId)}/responses${qs ? `?${qs}` : ''}`

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Forms rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 404) {
    throw new Error(`google-forms list_responses: form ${formId} not found`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-forms list_responses ${res.status}: ${text.slice(0, 200)}`)
  }
  const envelope = (await res.json()) as FormsListResponsesEnvelope
  const responses = (envelope.responses ?? []).map((r) => ({
    responseId: r.responseId,
    createTime: r.createTime,
    lastSubmittedTime: r.lastSubmittedTime,
    respondentEmail: r.respondentEmail,
    answers: flattenAnswers(r.answers),
    raw: r,
  }))
  return {
    data: {
      responses,
      nextPageToken: envelope.nextPageToken,
    },
    fetchedAt: Date.now(),
  }
}

async function getResponse(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { formId, responseId } = (inv.args ?? {}) as { formId: string; responseId: string }
  if (!formId) throw new Error('google-forms get_response: formId is required')
  if (!responseId) throw new Error('google-forms get_response: responseId is required')

  const res = await fetch(
    `${API}/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    },
  )
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Forms rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 404) {
    throw new Error(`google-forms get_response: response ${responseId} not found`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-forms get_response ${res.status}: ${text.slice(0, 200)}`)
  }
  const r = (await res.json()) as FormsResponse
  return {
    data: {
      responseId: r.responseId,
      createTime: r.createTime,
      lastSubmittedTime: r.lastSubmittedTime,
      respondentEmail: r.respondentEmail,
      answers: flattenAnswers(r.answers),
      raw: r,
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
    throw new Error('google-forms: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Google Forms access token expired and no refresh token', '')
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
