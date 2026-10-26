import type { OAuth2TokenClientAuthMethod, TokenMetadataSource } from './types.js'

export type OAuthPkceMode = 'required' | 'supported' | 'unsupported'

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
    const raw: unknown = await response.json().catch(() => { throw new Error(`OAuth ${operation} returned invalid JSON`) })
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

function oauthParameterName(value: string | undefined, fallback: string): string {
  const name = value ?? fallback
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name)) {
    throw new Error('Invalid OAuth parameter name')
  }
  return name
}

