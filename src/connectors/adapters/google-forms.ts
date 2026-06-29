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
 *   create_form(title, documentTitle?)
 *     → {formId, info, items, revisionId, responderUri}
 *     Mutation. POST /v1/forms. Per Forms API, only info.title /
 *     info.documentTitle may be set at creation; questions are added in
 *     a follow-up batch_update call.
 *
 *   batch_update(formId, requests, includeFormInResponse?, writeControl?)
 *     → {formId, replies, form?, writeControl?}
 *     Mutation. POST /v1/forms/{formId}:batchUpdate. The `requests` array
 *     is passed through unchanged; callers compose Forms `Request`
 *     objects (createItem / updateFormInfo / moveItem / deleteItem /
 *     updateItem / updateSettings) directly.
 *
 * Auth: OAuth2. Reads use `forms.body.readonly` + `forms.responses.readonly`.
 * Writes (`create_form`, `batch_update`) use `forms.body`, a Google
 * "restricted" scope — adding it to the default set upgrades this
 * connector to Google's security-review path. Submit_response remains
 * unsupported: the Forms API exposes no programmatic submission endpoint;
 * the only path is the public formResponse URL (a generic webhook).
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

// `forms.body` is a Google "restricted" scope: requesting it forces the
// OAuth client through Google's security review. Required for create_form
// and batch_update — there is no read-only mutation surface for Forms.
const SCOPE_WRITE = 'https://www.googleapis.com/auth/forms.body'
// Default scopes now include the write scope so fresh OAuth flows grant
// create_form / batch_update without a second consent round.
const SCOPES = [
  'https://www.googleapis.com/auth/forms.body.readonly',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  SCOPE_WRITE,
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
        {
          name: 'create_form',
          class: 'mutation',
          description:
            "Create a new Google Form. Returns the freshly-created Form resource (formId, info, revisionId, responderUri). Only info.title/documentTitle are accepted at creation time per Forms API; use batch_update afterwards to add items.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_WRITE],
          parameters: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Form title shown above the questions (info.title).',
              },
              documentTitle: {
                type: 'string',
                description:
                  'Drive document title (info.documentTitle). Defaults to `title` when omitted.',
              },
            },
            required: ['title'],
          },
        },
        {
          name: 'batch_update',
          class: 'mutation',
          description:
            "Apply a batch of Forms `Request` objects to an existing form (add items, update info, move/delete items, etc.). The `requests` array is passed through unchanged to the Forms API — see Google's Forms batchUpdate request reference.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_WRITE],
          parameters: {
            type: 'object',
            properties: {
              formId: { type: 'string' },
              requests: {
                type: 'array',
                description:
                  'Array of Forms `Request` objects passed through to the batchUpdate endpoint.',
                items: { type: 'object' },
              },
              includeFormInResponse: {
                type: 'boolean',
                default: false,
                description:
                  'When true, the response body includes the updated Form resource at `form`.',
              },
              writeControl: {
                type: 'object',
                description:
                  "Optional Forms WriteControl object (e.g. `{requiredRevisionId: 'rev_1'}`) to guard against concurrent edits.",
              },
            },
            required: ['formId', 'requests'],
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

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
      if (inv.capabilityName === 'create_form') return createForm(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'batch_update') return batchUpdate(inv, accessToken, timeoutMs)
      throw new Error(`google-forms: unknown mutation capability ${inv.capabilityName}`)
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
        if (!res.ok) {
          const body = await res.json().catch(() => undefined)
          return { ok: false, reason: googleTestFailureReason(res.status, body, 'Google Forms') }
        }
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
  if (res.status === 404) {
    throw new Error(`google-forms get_form: form ${formId} not found`)
  }
  if (!res.ok) {
    throw await googleApiError(res, 'google-forms get_form', inv.source.id)
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
  if (res.status === 404) {
    throw new Error(`google-forms list_responses: form ${formId} not found`)
  }
  if (!res.ok) {
    throw await googleApiError(res, 'google-forms list_responses', inv.source.id)
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
  if (res.status === 404) {
    throw new Error(`google-forms get_response: response ${responseId} not found`)
  }
  if (!res.ok) {
    throw await googleApiError(res, 'google-forms get_response', inv.source.id)
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

async function createForm(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { title, documentTitle } = (inv.args ?? {}) as {
    title?: string
    documentTitle?: string
  }
  if (!title) throw new Error('google-forms create_form: title is required')

  const info: { title: string; documentTitle?: string } = { title }
  if (documentTitle) info.documentTitle = documentTitle

  const res = await fetch(`${API}/forms`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ info }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw await googleApiError(res, 'google-forms create_form', inv.source.id)
  }
  const form = (await res.json()) as FormsForm
  return {
    status: 'committed',
    data: {
      formId: form.formId,
      info: form.info ?? {},
      items: form.items ?? [],
      revisionId: form.revisionId,
      responderUri: form.responderUri,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function batchUpdate(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { formId, requests, includeFormInResponse, writeControl } = (inv.args ?? {}) as {
    formId?: string
    requests?: unknown[]
    includeFormInResponse?: boolean
    writeControl?: Record<string, unknown>
  }
  if (!formId) throw new Error('google-forms batch_update: formId is required')
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('google-forms batch_update: requests is required (non-empty array)')
  }

  const body: Record<string, unknown> = { requests }
  if (typeof includeFormInResponse === 'boolean') body.includeFormInResponse = includeFormInResponse
  if (writeControl) body.writeControl = writeControl

  const res = await fetch(`${API}/forms/${encodeURIComponent(formId)}:batchUpdate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw await googleApiError(res, 'google-forms batch_update', inv.source.id)
  }
  const json = (await res.json()) as {
    form?: FormsForm
    replies?: unknown[]
    writeControl?: Record<string, unknown>
  }
  return {
    status: 'committed',
    data: {
      formId,
      replies: json.replies ?? [],
      form: json.form,
      writeControl: json.writeControl,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
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
