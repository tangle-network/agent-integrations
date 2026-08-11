/**
 * Generic OAuth2 helper used by every oauth-shaped connector (Google
 * Calendar, Sheets, Drive, HubSpot, Salesforce, Zoom, ...).
 *
 * Everything PKCE-aware. Opaque-state CSRF guard. Refresh-token aware.
 * No connector-specific logic lives here — adapters hand a `clientId`,
 * `clientSecret`, `tokenUrl`, optional `extraAuthParams` and the rest is
 * mechanical.
 *
 * State and code_verifier are kept in a short-TTL flow store keyed by the
 * opaque `state` we round-trip through the provider. The default store is
 * in-memory for local/dev and tests. Production deployments should inject a
 * durable store backed by KV/Redis/D1/etc. so callbacks can land on any worker.
 */

import { createHash, randomBytes } from 'crypto'
import type { OAuth2TokenClientAuthMethod } from './types.js'

export type OAuthPkceMode = 'required' | 'supported' | 'unsupported'

export interface PendingOAuthFlow {
  /** code_verifier for PKCE. Absent when the provider rejects PKCE. */
  codeVerifier?: string
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

const PENDING_TTL_MS = 10 * 60 * 1000

export interface OAuthFlowStore {
  put(state: string, flow: PendingOAuthFlow): Promise<void> | void
  consume(state: string): Promise<PendingOAuthFlow | undefined> | PendingOAuthFlow | undefined
  sweep?(now: number): Promise<void> | void
  clear?(): Promise<void> | void
}

export class InMemoryOAuthFlowStore implements OAuthFlowStore {
  private readonly pendingFlows = new Map<string, PendingOAuthFlow>()

  put(state: string, flow: PendingOAuthFlow): void {
    this.pendingFlows.set(state, flow)
  }

  consume(state: string): PendingOAuthFlow | undefined {
    const flow = this.pendingFlows.get(state)
    this.pendingFlows.delete(state)
    if (!flow || flow.expiresAt <= Date.now()) return undefined
    return flow
  }

  sweep(now: number): void {
    for (const [k, v] of this.pendingFlows) {
      if (v.expiresAt <= now) this.pendingFlows.delete(k)
    }
  }

  clear(): void {
    this.pendingFlows.clear()
  }
}

const defaultFlowStore = new InMemoryOAuthFlowStore()

export interface StartOAuthInput {
  projectId: string
  kind: string
  label: string
  authorizationUrl: string
  scopes: string[]
  /** OAuth defaults to spaces; set `,` for providers such as Zoho. */
  scopeSeparator?: ' ' | ','
  clientId: string
  /** Authorization query parameter for the client id. Defaults to
   *  `client_id`; TikTok uses `client_key`. */
  authorizationClientIdParam?: string
  /** PKCE posture. Defaults to required to preserve the existing safe flow. */
  pkce?: OAuthPkceMode
  redirectUri: string
  /** Optional extra query params; Google needs `access_type=offline` and
   *  `prompt=consent` to issue refresh tokens reliably. */
  extraAuthParams?: Record<string, string>
  /** Optional flow store. Use a durable store in distributed production
   *  runtimes; omitted means local in-memory storage. */
  store?: OAuthFlowStore
  /** Override clock for tests. */
  now?: number
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
  const store = input.store ?? defaultFlowStore
  const now = input.now ?? Date.now()
  store.sweep?.(now)
  const usePkce = (input.pkce ?? 'required') !== 'unsupported'
  const codeVerifier = usePkce ? base64Url(randomBytes(48)) : undefined
  const codeChallenge = codeVerifier
    ? base64Url(createHash('sha256').update(codeVerifier).digest())
    : undefined
  const state = base64Url(randomBytes(24))

  store.put(state, {
    codeVerifier,
    state,
    projectId: input.projectId,
    kind: input.kind,
    label: input.label,
    redirectUri: input.redirectUri,
    expiresAt: now + PENDING_TTL_MS,
  })

  const url = new URL(input.authorizationUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set(
    oauthParameterName(input.authorizationClientIdParam, 'client_id'),
    input.clientId,
  )
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('scope', input.scopes.join(input.scopeSeparator ?? ' '))
  url.searchParams.set('state', state)
  if (input.extraAuthParams) {
    for (const [k, v] of Object.entries(input.extraAuthParams)) {
      url.searchParams.set(k, v)
    }
  }
  if (codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  } else {
    url.searchParams.delete('code_challenge')
    url.searchParams.delete('code_challenge_method')
  }
  return { authorizationUrl: url.toString(), state }
}

/** Look up + remove the pending flow record. Throws if state is unknown
 *  or expired (CSRF guard / replay protection). */
export async function consumePendingFlow(state: string, store: OAuthFlowStore = defaultFlowStore): Promise<PendingOAuthFlow> {
  await store.sweep?.(Date.now())
  const flow = await store.consume(state)
  if (!flow) {
    throw new Error('Unknown or expired OAuth state: possible CSRF, replay, or stale flow')
  }
  return flow
}

export interface ExchangeCodeInput {
  tokenUrl: string
  clientId: string
  /** Required unless tokenClientAuthMethod is `none`. */
  clientSecret?: string
  /** Defaults to client_secret_post for backward compatibility. */
  tokenClientAuthMethod?: OAuth2TokenClientAuthMethod
  tokenClientIdParam?: string
  tokenClientSecretParam?: string
  code: string
  /** Required unless pkce is explicitly unsupported. */
  codeVerifier?: string
  /** PKCE posture. Defaults to required. */
  pkce?: OAuthPkceMode
  redirectUri: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scope?: string
  tokenType?: string
  /** OpenID Connect identity token returned when the connector requests
   *  `openid`. Kept separate from the access credential so adapters can
   *  capture stable account metadata without persisting the ID token. */
  idToken?: string
}

/** POST authorization code → token endpoint. Provider-agnostic; if a
 *  provider returns a non-standard JSON shape, the adapter wraps this
 *  call rather than reaching into the helper. */
export async function exchangeAuthorizationCode(input: ExchangeCodeInput): Promise<OAuthTokens> {
  const usePkce = (input.pkce ?? 'required') !== 'unsupported'
  if (usePkce && !input.codeVerifier) {
    throw new Error('OAuth token exchange requires a PKCE code_verifier')
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  })
  if (usePkce) body.set('code_verifier', input.codeVerifier!)
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  }
  applyTokenClientAuthentication(input, body, headers)
  const res = await (input.fetchImpl ?? fetch)(input.tokenUrl, {
    method: 'POST',
    headers,
    body,
    signal: input.signal,
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
    id_token?: string
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
    tokenType: json.token_type,
    idToken: json.id_token,
  }
}

export interface RefreshInput {
  tokenUrl: string
  clientId: string
  /** Required unless tokenClientAuthMethod is `none`. */
  clientSecret?: string
  /** Defaults to client_secret_post for backward compatibility. */
  tokenClientAuthMethod?: OAuth2TokenClientAuthMethod
  tokenClientIdParam?: string
  tokenClientSecretParam?: string
  refreshToken: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/** Refresh an access token. Returns the new tokens — the connector layer
 *  is responsible for re-encrypting + persisting the envelope. */
export async function refreshAccessToken(input: RefreshInput): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  })
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  }
  applyTokenClientAuthentication(input, body, headers)
  const res = await (input.fetchImpl ?? fetch)(input.tokenUrl, {
    method: 'POST',
    headers,
    body,
    signal: input.signal,
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
    id_token?: string
  }
  return {
    accessToken: json.access_token,
    // Some providers omit refresh_token on refresh — keep the previous one
    // in that case (caller passes through if undefined).
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
    tokenType: json.token_type,
    idToken: json.id_token,
  }
}

function applyTokenClientAuthentication(
  input: {
    clientId: string
    clientSecret?: string
    tokenClientIdParam?: string
    tokenClientSecretParam?: string
    tokenClientAuthMethod?: OAuth2TokenClientAuthMethod
  },
  body: URLSearchParams,
  headers: Record<string, string>,
): void {
  const method = input.tokenClientAuthMethod ?? 'client_secret_post'
  if (method === 'none') {
    body.set(oauthParameterName(input.tokenClientIdParam, 'client_id'), input.clientId)
    return
  }
  if (!input.clientSecret) {
    throw new Error(`OAuth ${method} client authentication requires a client secret`)
  }
  if (method === 'client_secret_post') {
    body.set(oauthParameterName(input.tokenClientIdParam, 'client_id'), input.clientId)
    body.set(
      oauthParameterName(input.tokenClientSecretParam, 'client_secret'),
      input.clientSecret,
    )
    return
  }
  if (method === 'client_secret_basic') {
    headers.authorization = `Basic ${Buffer.from(
      `${input.clientId}:${input.clientSecret}`,
      'utf8',
    ).toString('base64')}`
    return
  }
  throw new Error('Unsupported OAuth token client authentication method')
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function oauthParameterName(value: string | undefined, fallback: string): string {
  const name = value ?? fallback
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name)) {
    throw new Error('Invalid OAuth parameter name')
  }
  return name
}

/** Test-only — drop pending flows between unit-test runs. */
export function _resetPendingFlowsForTests(): void {
  defaultFlowStore.clear?.()
}
