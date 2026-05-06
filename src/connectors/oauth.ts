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

export interface PendingOAuthFlow {
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
  clientId: string
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
  const codeVerifier = base64Url(randomBytes(48))
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())
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
  clientSecret: string
  code: string
  codeVerifier: string
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
  const res = await (input.fetchImpl ?? fetch)(input.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
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
  fetchImpl?: typeof fetch
  signal?: AbortSignal
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
  const res = await (input.fetchImpl ?? fetch)(input.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
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
  defaultFlowStore.clear?.()
}
