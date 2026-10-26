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
import type { OAuth2TokenClientAuthMethod, TokenMetadataSource } from './types.js'

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

  return {
    authorizationUrl: buildOAuthAuthorizationUrl({ ...input, state, codeChallenge }),
    state,
  }
}

/** Shared by stateful flows and hosts that persist their own state. Reserved
 * parameters always override provider extras and values embedded in the URL. */
export function buildOAuthAuthorizationUrl(input: {
  authorizationUrl: string
  clientId: string
  authorizationClientIdParam?: string
  redirectUri: string
  scopes: readonly string[]
  scopeSeparator?: ' ' | ','
  sendScopeParam?: boolean
  configId?: string
  state: string
  codeChallenge?: string
  extraAuthParams?: Readonly<Record<string, string>>
}): string {
  const url = new URL(input.authorizationUrl)
  for (const [key, value] of Object.entries(input.extraAuthParams ?? {})) url.searchParams.set(key, value)
  for (const key of ['client_id', 'scope', 'config_id', 'code_challenge', 'code_challenge_method']) url.searchParams.delete(key)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set(oauthParameterName(input.authorizationClientIdParam, 'client_id'), input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  if (input.configId) url.searchParams.set('config_id', input.configId)
  else if (input.sendScopeParam !== false && input.scopes.length) url.searchParams.set('scope', input.scopes.join(input.scopeSeparator ?? ' '))
  if (input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  return url.toString()
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
  tokenMetadata?: Record<string, TokenMetadataSource>
  /** Required unless pkce is explicitly unsupported. */
  codeVerifier?: string
  /** PKCE posture. Defaults to required. */
  pkce?: OAuthPkceMode
  redirectUri: string
  /** Non-secret provider identification headers for the token request. */
  tokenRequestHeaders?: Readonly<Record<string, string>>
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
  /** Only explicitly declared, non-credential token response fields. */
  metadata?: Record<string, string>
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
  return requestOAuthTokens(input, body, 'token exchange', [input.code, input.codeVerifier ?? ''])
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
  /** Non-secret provider identification headers for the token request. */
  tokenRequestHeaders?: Readonly<Record<string, string>>
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
  return requestOAuthTokens(input, body, 'refresh', [input.refreshToken])
}

async function requestOAuthTokens(
  input: RefreshInput | ExchangeCodeInput,
  body: URLSearchParams,
  operation: string,
  secrets: string[],
): Promise<OAuthTokens> {
  const headers = createOAuthTokenRequestHeaders(input.tokenRequestHeaders)
  applyTokenClientAuthentication(input, body, headers)
  const redaction = [...secrets, ...oauthClientCredentialRedactionValues(input.clientId, input.clientSecret, headers.authorization)]
  try {
    const response = await (input.fetchImpl ?? fetch)(input.tokenUrl, {
      method: 'POST', headers, body, signal: input.signal,
    })
    if (!response.ok) {
      const detail = `${response.status} ${response.statusText} — ${await response.text()}`
      throw new Error(`OAuth ${operation} failed: ${detail}`)
    }
    const raw: unknown = await response.json()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`OAuth ${operation} returned invalid JSON`)
    const json = raw as Record<string, unknown>
    if (typeof json.access_token !== 'string' || !json.access_token) throw new Error(`OAuth ${operation} returned no access_token`)
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
      scope: typeof json.scope === 'string' ? json.scope : undefined,
      tokenType: typeof json.token_type === 'string' ? json.token_type : undefined,
      idToken: typeof json.id_token === 'string' ? json.id_token : undefined,
      ...('tokenMetadata' in input && input.tokenMetadata ? { metadata: captureOAuthTokenMetadata(input.tokenMetadata, json) } : {}),
    }
  } catch (cause) {
    throw new Error(redactOAuthSensitiveText(cause instanceof Error ? cause.message : `OAuth ${operation} failed`, redaction).slice(0, 500))
  }
}

export function captureOAuthTokenMetadata(
  tokenMetadata: Record<string, TokenMetadataSource> | undefined,
  json: Record<string, unknown>,
): Record<string, string> {
  if (!tokenMetadata) return {}
  const captured: Record<string, string> = {}
  for (const [metaKey, source] of Object.entries(tokenMetadata)) {
    const field = typeof source === 'string' ? source : source.field
    const required = typeof source === 'string' ? false : source.required === true
    const raw = json[field]
    // Trim string values so capture-side emptiness matches the consumer's
    // emptiness check (e.g. resolveBaseUrl's `.trim()` guard). A whitespace-only
    // value must fail loud here at connect for a required field, not defer the
    // break to first call where the host already looks active.
    const value = typeof raw === 'string' ? raw.trim() : raw
    if (value === undefined || value === null || value === '') {
      if (required) {
        throw new Error(
          `OAuth token exchange did not return required field "${field}" for metadata.${metaKey}.`,
        )
      }
      continue
    }
    captured[metaKey] = String(value)
  }
  return captured
}

/** Build token-endpoint headers without permitting an adapter-supplied value
 *  to replace the authentication or form-media-type headers owned here. */
export function createOAuthTokenRequestHeaders(
  additional?: Readonly<Record<string, string>>,
): Record<string, string> {
  const headers = new Headers(additional)
  headers.set('content-type', 'application/x-www-form-urlencoded')
  headers.set('accept', 'application/json')
  headers.delete('authorization')
  return Object.fromEntries(headers.entries())
}

export function formEncodeOAuthClientCredential(value: string): string {
  return new URLSearchParams({ value }).toString().slice('value='.length)
}

export function createOAuthBasicAuthorizationHeader(
  clientId: string,
  clientSecret: string,
  encodeBase64: (value: string) => string = defaultOAuthBase64Encode,
): string {
  const encodedClientId = formEncodeOAuthClientCredential(clientId)
  const encodedClientSecret = formEncodeOAuthClientCredential(clientSecret)
  return `Basic ${encodeBase64(`${encodedClientId}:${encodedClientSecret}`)}`
}

function defaultOAuthBase64Encode(value: string): string {
  const encode = globalThis.btoa
  if (typeof encode !== 'function') {
    throw new Error(
      'OAuth client_secret_basic requires a base64 encoder in this runtime.',
    )
  }
  return encode(value)
}

export function oauthClientCredentialRedactionValues(
  clientId: string,
  clientSecret?: string,
  authorization?: string,
): string[] {
  return [
    clientId,
    ...(clientSecret ? [clientSecret] : []),
    ...(authorization
      ? [
          authorization,
          ...(authorization.startsWith('Basic ')
            ? [authorization.slice('Basic '.length)]
            : []),
        ]
      : []),
  ]
}

export function redactOAuthSensitiveText(
  text: string,
  secrets: readonly string[],
): string {
  const matchers = new Map<string, { pattern: RegExp; representedLength: number }>()
  for (const secret of new Set(secrets)) {
    if (secret.length === 0) continue
    addOAuthRedactionMatcher(matchers, escapeRegExp(secret), secret.length)

    const jsonEscaped = JSON.stringify(secret).slice(1, -1)
    addOAuthRedactionMatcher(
      matchers,
      escapeRegExp(jsonEscaped),
      jsonEscaped.length,
    )

    const formEncoded = formEncodeOAuthClientCredential(secret)
    addOAuthRedactionMatcher(
      matchers,
      formEncodedRedactionPattern(formEncoded),
      Math.max(formEncoded.length, formEncoded.replaceAll('+', '%20').length),
    )
  }

  return [...matchers.values()]
    .sort((left, right) => right.representedLength - left.representedLength)
    .reduce(
      (redacted, matcher) => redacted.replace(matcher.pattern, '[REDACTED]'),
      text,
    )
}

function addOAuthRedactionMatcher(
  matchers: Map<string, { pattern: RegExp; representedLength: number }>,
  source: string,
  representedLength: number,
): void {
  const existing = matchers.get(source)
  if (existing && existing.representedLength >= representedLength) return
  matchers.set(source, {
    pattern: new RegExp(source, 'g'),
    representedLength,
  })
}

function formEncodedRedactionPattern(formEncoded: string): string {
  let pattern = ''
  for (let index = 0; index < formEncoded.length; index += 1) {
    const character = formEncoded[index]!
    const encodedByte = formEncoded.slice(index + 1, index + 3)
    if (character === '%' && /^[0-9A-F]{2}$/.test(encodedByte)) {
      pattern += `%${percentEncodedBytePattern(encodedByte)}`
      index += 2
      continue
    }
    if (character === '+') {
      pattern += '(?:\\+|%20)'
      continue
    }
    pattern += escapeRegExp(character)
  }
  return pattern
}

function percentEncodedBytePattern(encodedByte: string): string {
  return [...encodedByte]
    .map((character) =>
      /[A-F]/.test(character)
        ? `[${character}${character.toLowerCase()}]`
        : character,
    )
    .join('')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    headers.authorization = createOAuthBasicAuthorizationHeader(
      input.clientId,
      input.clientSecret,
    )
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
