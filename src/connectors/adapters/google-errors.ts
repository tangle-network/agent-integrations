/**
 * Google API error classification.
 *
 * Google's JSON APIs collapse several very different failure modes onto HTTP
 * 403: a credential that's actually been revoked, a project whose API isn't
 * enabled (`accessNotConfigured`), a missing OAuth scope
 * (`insufficientPermissions`), AND a daily/per-user quota throttle
 * (`dailyLimitExceeded` — Gmail/Calendar surface quota as 403, not 429). The
 * actionable signal is the body's `error.errors[0].reason` (or the top-level
 * `error.status`), NOT the status code.
 *
 * Reading the body BEFORE deciding it's a credential failure is the whole
 * point: it lets the platform route config/permission 403s to "fix the
 * project/scope" and quota 403s to rate-limited, instead of flipping the hub
 * connection to `reconnect_required` (an unresolvable loop — reconnecting can't
 * enable an API or refill a quota window).
 *
 * The returned typed errors (`CredentialsExpired` / `ProviderConfigError` /
 * `ProviderRateLimited`) carry structured `{status, reason, body}` so the
 * reason survives to the platform classifier, and their messages embed the
 * status (+ "rate limit" for quota) so a platform that only inspects the
 * message string still classifies correctly.
 */

import {
  CredentialsExpired,
  ProviderConfigError,
  ProviderRateLimited,
} from '../types.js'

/** Shape of a Google JSON API error envelope. */
interface GoogleErrorEnvelope {
  error?: {
    code?: number
    status?: string
    message?: string
    errors?: Array<{ reason?: string; message?: string; domain?: string }>
  }
}

// Reason vocabularies (compared lowercased). Google surfaces the actionable
// reason in `error.errors[0].reason` and the canonical class in `error.status`;
// we route on whichever is present.
const AUTH_REASONS = new Set([
  'autherror',
  'authenticationerror',
  'invalidcredentials',
  'invalid_grant',
  'invalidgrant',
  'unauthorized',
  'unauthenticated',
  'logindenied',
])
const CONFIG_REASONS = new Set([
  'accessnotconfigured',
  'insufficientpermissions',
  'insufficientscopes',
  'forbidden',
  'permissiondenied',
  'permission_denied',
  'ssorequired',
])
const QUOTA_REASONS = new Set([
  'ratelimitexceeded',
  'userratelimitexceeded',
  'userratelimitexceededunreg',
  'dailylimitexceeded',
  'quotaexceeded',
  'resourceexhausted',
  'resource_exhausted',
])

export type GoogleErrorClass = 'auth' | 'config' | 'quota'

/** Extract the most specific reason token from a Google error body:
 *  `error.errors[0].reason`, else the top-level `error.status`. */
export function googleErrorReason(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const error = (body as GoogleErrorEnvelope).error
  if (!error || typeof error !== 'object') return undefined
  const fromErrors = error.errors?.find(
    (entry) => typeof entry?.reason === 'string' && entry.reason.length > 0,
  )?.reason
  if (fromErrors) return fromErrors
  if (typeof error.status === 'string' && error.status.length > 0) {
    return error.status
  }
  return undefined
}

/** Map a Google reason token to its failure class, or undefined if unknown. */
export function classifyGoogleReason(
  reason: string | undefined,
): GoogleErrorClass | undefined {
  if (!reason) return undefined
  const key = reason.toLowerCase()
  if (QUOTA_REASONS.has(key)) return 'quota'
  if (AUTH_REASONS.has(key)) return 'auth'
  if (CONFIG_REASONS.has(key)) return 'config'
  return undefined
}

function stringifyBody(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  return text.slice(0, 200)
}

/**
 * Turn a Google API failure (status + parsed body) into the typed error that
 * reflects WHY it failed. Precedence — a matched reason always beats the bare
 * status, because Gmail/Calendar overload 403 for quota and permission alike:
 *
 *   1. quota reason | 429        → ProviderRateLimited
 *   2. auth reason  | bare 401   → CredentialsExpired (reconnect fixes it)
 *   3. config reason| bare 403   → ProviderConfigError (reconnect can't fix it)
 *   4. anything else             → generic Error (status + body snippet)
 */
export function classifyGoogleError(
  status: number,
  body: unknown,
  context: string,
  dataSourceId: string,
): Error {
  const reason = googleErrorReason(body)
  const cls = classifyGoogleReason(reason)
  const init = { status, reason, body }
  const suffix = reason ? `: ${reason}` : ''

  if (cls === 'quota' || status === 429) {
    return new ProviderRateLimited(
      `${context} rate limit (${status})${suffix}`,
      dataSourceId,
      init,
    )
  }
  if (cls === 'auth' || status === 401) {
    return new CredentialsExpired(
      `${context} rejected token (${status})${suffix}`,
      dataSourceId,
      init,
    )
  }
  if (cls === 'config' || status === 403) {
    return new ProviderConfigError(
      `${context} permission/config error (${status})${suffix}`,
      dataSourceId,
      init,
    )
  }
  return new Error(`${context} ${status}: ${stringifyBody(body)}`)
}

/**
 * Read a non-OK Google API Response and return the typed error reflecting why
 * it failed, reading the provider error body BEFORE classifying. The body is
 * consumed exactly once (as text, then JSON-parsed) so the caller must only
 * invoke this after confirming `!res.ok`. `context` carries the capability for
 * the message (e.g. `"gmail list_messages"`); `dataSourceId` threads onto the
 * credential errors so the hub can identify the connection.
 */
export async function googleApiError(
  res: Response,
  context: string,
  dataSourceId: string,
): Promise<Error> {
  const body = await readErrorBody(res)
  return classifyGoogleError(res.status, body, context, dataSourceId)
}

/** Human-readable reason for a connector `test()` result on a non-OK response.
 *  Mirrors `classifyGoogleError`'s routing but only says "reconnect required"
 *  for a true credential failure — a config/quota 403 gets actionable text
 *  instead of a misleading reconnect prompt. */
export function googleTestFailureReason(
  status: number,
  body: unknown,
  provider: string,
): string {
  const reason = googleErrorReason(body)
  const cls = classifyGoogleReason(reason)
  const detail = reason ? `, ${reason}` : ''
  if (cls === 'quota' || status === 429) {
    return `${provider} rate limit (${status}${detail}) — retry later`
  }
  if (cls === 'auth' || status === 401) {
    return `${provider} rejected token (${status}${detail}) — reconnect required`
  }
  if (cls === 'config' || status === 403) {
    return `${provider} permission/config error (${status}${detail}) — check the API is enabled and scopes are granted`
  }
  return `${provider} returned ${status}`
}

async function readErrorBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
