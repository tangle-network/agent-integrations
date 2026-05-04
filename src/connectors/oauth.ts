/**
 * Generic OAuth2 helper used by every oauth-shaped connector (Google
 * Calendar, Sheets, Drive, HubSpot, Salesforce, Zoom, ...).
 *
 * Everything PKCE-aware. Opaque-state CSRF guard. Refresh-token aware.
 * No connector-specific logic lives here — adapters hand a `clientId`,
 * `clientSecret`, `tokenUrl`, optional `extraAuthParams` and the rest is
 * mechanical.
 *
 * State and code_verifier are kept in a short-TTL in-memory map keyed by
 * the opaque `state` we round-trip through the provider. We do NOT use a
 * cookie — the provider's redirect happens on a different origin and
 * cookie scoping gets messy. The map is small (capped) and a single
 * Railway container handles each user's flow within a few seconds.
 */

import { createHash, randomBytes } from 'crypto'

interface PendingFlow {
  /** code_verifier for PKCE. */
  codeVerifier: string
  /** Opaque-state value also returned in the OAuth redirect. */
  state: string
  /** Project the user is connecting under. */
  projectId: string
  /** Connector kind (e.g. 'google-calendar'). */
  kind: string
  /** Operator-supplied label that becomes DataSource.label. */
  label: string
  /** When we drop the entry. */
  expiresAt: number
  /** The redirectUri we used in the start step — must match exactly on
   *  the callback exchange. */
  redirectUri: string
}

const pendingFlows = new Map<string, PendingFlow>()
const PENDING_TTL_MS = 10 * 60 * 1000

function sweep(): void {
  const now = Date.now()
  for (const [k, v] of pendingFlows) {
    if (v.expiresAt <= now) pendingFlows.delete(k)
  }
}

export interface StartOAuthInput {
  projectId: string
  kind: string
  label: string
  authorizationUrl: string
  scopes: string[]
  clientId: string
  redirectUri: string
  /** Optional extra query params; Google needs `access_type=offline` and
   *  `prompt=consent` to issue refresh tokens reliably. */
  extraAuthParams?: Record<string, string>
}

export interface StartOAuthOutput {
  /** URL the SPA should redirect the user to. */
  authorizationUrl: string
  /** State token — caller stashes this in localStorage to verify on
   *  callback. */
  state: string
}

/** Build the authorization URL + state. SPA navigates the user there;
 *  user consents; provider redirects back to redirectUri with `code` +
 *  `state`. The caller's callback then invokes `consumePendingFlow`. */
export function startOAuthFlow(input: StartOAuthInput): StartOAuthOutput {
  sweep()
  const codeVerifier = base64Url(randomBytes(48))
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())
  const state = base64Url(randomBytes(24))

  pendingFlows.set(state, {
    codeVerifier,
    state,
    projectId: input.projectId,
    kind: input.kind,
    label: input.label,
    redirectUri: input.redirectUri,
    expiresAt: Date.now() + PENDING_TTL_MS,
  })

  const url = new URL(input.authorizationUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('scope', input.scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (input.extraAuthParams) {
    for (const [k, v] of Object.entries(input.extraAuthParams)) {
      url.searchParams.set(k, v)
    }
  }
  return { authorizationUrl: url.toString(), state }
}

/** Look up + remove the pending flow record. Throws if state is unknown
 *  or expired (CSRF guard / replay protection). */
export function consumePendingFlow(state: string): PendingFlow {
  sweep()
  const flow = pendingFlows.get(state)
  if (!flow) {
    throw new Error('Unknown or expired OAuth state — likely CSRF or stale flow')
  }
  pendingFlows.delete(state)
  return flow
}

export interface ExchangeCodeInput {
  tokenUrl: string
  clientId: string
  clientSecret: string
  code: string
  codeVerifier: string
  redirectUri: string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scope?: string
  tokenType?: string
}

/** POST authorization code → token endpoint. Provider-agnostic; if a
 *  provider returns a non-standard JSON shape, the adapter wraps this
 *  call rather than reaching into the helper. */
export async function exchangeAuthorizationCode(input: ExchangeCodeInput): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  })
  const res = await fetch(input.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OAuth token exchange failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    token_type?: string
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
    tokenType: json.token_type,
  }
}

export interface RefreshInput {
  tokenUrl: string
  clientId: string
  clientSecret: string
  refreshToken: string
}

/** Refresh an access token. Returns the new tokens — the connector layer
 *  is responsible for re-encrypting + persisting the envelope. */
export async function refreshAccessToken(input: RefreshInput): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
  })
  const res = await fetch(input.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OAuth refresh failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    token_type?: string
  }
  return {
    accessToken: json.access_token,
    // Some providers omit refresh_token on refresh — keep the previous one
    // in that case (caller passes through if undefined).
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
    tokenType: json.token_type,
  }
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** Test-only — drop pending flows between unit-test runs. */
export function _resetPendingFlowsForTests(): void {
  pendingFlows.clear()
}
