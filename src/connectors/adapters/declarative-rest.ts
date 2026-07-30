import { isIP } from 'node:net'
import {
  type Capability,
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ConnectorInvocation,
  CredentialsExpired,
  ProviderRateLimited,
} from '../types.js'
import {
  type AwsCredentialBundle,
  amzDateNow,
  canonicalizeAwsQuery,
  hashSha256Hex,
  parseAwsCredentialBundle,
  signSigV4,
} from './aws-sigv4.js'

export type RestCredentialPlacement =
  | { kind: 'bearer' }
  /** HTTP Basic with the API key as the username and an empty password.
   *  Insightly uses this convention for its otherwise single-secret auth. */
  | { kind: 'basic-api-key' }
  | { kind: 'header'; header: string; prefix?: string }
  | { kind: 'query'; parameter: string }
  /** Multi-part credentials stored as either `custom.values` or a JSON object
   *  in the api-key field. Keys are copied into provider headers. This keeps
   *  Bill.com's developer key + session id inside the encrypted credential
   *  envelope instead of leaking either through connection metadata. */
  | { kind: 'structured-headers'; fields: Readonly<Record<string, string>> }
  /** Multi-part credentials copied into a JSON request body. Plaid requires
   *  client_id, secret, and access_token on every request rather than using an
   *  Authorization header. Credential values override model-authored args. */
  | { kind: 'structured-json-body'; fields: Readonly<Record<string, string>> }
  /** AWS Signature Version 4. The api-key credential field carries a JSON
   *  bundle (accessKeyId + secretAccessKey + region [+ sessionToken, endpoint]);
   *  the runtime signs each request at fetch time. `service` is the SigV4
   *  signing name (e.g. `sqs`, `s3`); `defaultRegion` is used only when neither
   *  the bundle nor connection metadata supplies a region. The target host is
   *  derived from the region via the adapter's `{region}`-templated baseUrl. */
  | { kind: 'aws-sigv4'; service: string; defaultRegion?: string }

export interface RestConnectorSpec {
  kind: string
  displayName: string
  description: string
  auth: ConnectorAdapter['manifest']['auth']
  category: ConnectorAdapter['manifest']['category']
  defaultConsistencyModel: ConnectorAdapter['manifest']['defaultConsistencyModel']
  baseUrl: string | { metadataKey: string; fallback?: string }
  /** Exact upstream base URLs accepted after connection-metadata resolution.
   *  Use this for regional SaaS hosts so a user-controlled metadata value
   *  cannot redirect provider credentials to an arbitrary server. */
  allowedBaseUrls?: readonly string[]
  /** HTTPS hostname suffixes accepted for tenant-specific provider hosts.
   *  A suffix `.example.com` accepts `tenant.example.com`, never
   *  `example.com.attacker.test`. */
  allowedBaseUrlSuffixes?: readonly string[]
  /** Require a user-supplied host to use HTTPS and reject literal/private
   *  network targets. Use this for federated providers that cannot be pinned
   *  to one vendor suffix, such as Mastodon. */
  requirePublicHttpsBaseUrl?: boolean
  credentialPlacement?: RestCredentialPlacement
  defaultHeaders?: Record<string, string>
  capabilities: RestOperationSpec[]
  test?: RestTestSpec
}

export interface RestOperationSpec {
  name: string
  class: 'read' | 'mutation'
  description: string
  parameters: Record<string, unknown>
  requiredScopes?: string[]
  request: RestRequestSpec
  cas?: 'etag-if-match' | 'native-idempotency' | 'optimistic-read-verify' | 'none'
  externalEffect?: boolean
}

export interface RestRequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  body?: 'args' | string | Record<string, unknown>
  /** Existence-probe operations (e.g. GitHub star/follow/membership checks)
   *  encode the answer in the HTTP status: 204 = present, 404 = absent. Set
   *  this so the adapter maps both to an explicit `{ exists: boolean }` instead
   *  of returning a null body on 204 and THROWING on 404. Any other non-2xx
   *  status still fails loud through the normal error path. */
  existenceCheck?: boolean
}

export interface RestTestSpec extends RestRequestSpec {
  expectResponse?: RestResponseExpectation | RestResponseExpectation[]
}

export interface RestResponseExpectation {
  path: string
  equals: unknown
}

export function declarativeRestConnector(spec: RestConnectorSpec): ConnectorAdapter {
  const capabilities = spec.capabilities.map(operationToCapability)
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: spec.kind,
      displayName: spec.displayName,
      description: spec.description,
      auth: spec.auth,
      category: spec.category,
      defaultConsistencyModel: spec.defaultConsistencyModel,
      capabilities,
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const op = readOperation(spec, inv.capabilityName, 'read')
      const response = await executeRestRequest(spec, op.request, inv, requiredArgsOf(op.parameters))
      // `CapabilityReadResult` has no soft-failure channel, so a tagged
      // transport outcome MUST throw here: returning it as `data` reported the
      // provider's 429/409 error body as a successful read — the caller (and
      // `invokeAction`, which wraps every read result in `ok: true`) then
      // treated "API rate limit exceeded" as the answer to the read.
      if (response.outcome === 'rate-limited') {
        const retryAfterMs = response.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS
        throw new ProviderRateLimited(
          `${spec.displayName} ${inv.capabilityName} rate limit (429); retry after ${retryAfterMs}ms`,
          inv.source.id,
          { status: 429, body: response.data, retryAfterMs },
        )
      }
      if (response.outcome === 'conflict') {
        throw new Error(
          `${spec.kind} ${op.request.method} ${op.request.path} HTTP ${response.status ?? 409}: ${(response.message ?? '').slice(0, 300)}`,
        )
      }
      return {
        data: response.data,
        etag: response.etag,
        fetchedAt: Date.now(),
      }
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const op = readOperation(spec, inv.capabilityName, 'mutation')
      const response = await executeRestRequest(spec, op.request, inv, requiredArgsOf(op.parameters))
      return mutationResultFromTransport(spec.displayName, response)
    },

    async test(source) {
      if (!spec.test) return { ok: true }
      try {
        const response = await executeRestRequest(spec, spec.test, {
          source,
          capabilityName: '__test__',
          args: {},
          idempotencyKey: 'test',
        })
        // A throttled or conflicted probe proved nothing about the connection;
        // validating expectations against the provider's error body (or
        // passing outright when the spec has none) would report a health check
        // that never ran as green.
        if (response.outcome) {
          return {
            ok: false,
            reason: response.message || `${spec.displayName} test request was ${response.outcome}`,
          }
        }
        validateTestResponse(spec, spec.test, response.data)
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' }
      }
    },
  }
  return adapter
}

function validateTestResponse(spec: RestConnectorSpec, test: RestTestSpec, data: unknown): void {
  const expectations = Array.isArray(test.expectResponse)
    ? test.expectResponse
    : test.expectResponse
      ? [test.expectResponse]
      : []
  for (const expectation of expectations) {
    const actual = readPathFromUnknown(data, expectation.path)
    if (!isJsonEqual(actual, expectation.equals)) {
      throw new Error(
        `${spec.displayName} test response expected ${expectation.path}=${formatValue(expectation.equals)}, got ${formatValue(actual)}`,
      )
    }
  }
}

function isJsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  return JSON.stringify(left) === JSON.stringify(right)
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

function operationToCapability(op: RestOperationSpec): Capability {
  const base = {
    name: op.name,
    description: op.description,
    parameters: op.parameters,
    requiredScopes: op.requiredScopes,
  }
  if (op.class === 'read') {
    return { ...base, class: 'read' }
  }
  return {
    ...base,
    class: 'mutation',
    cas: op.cas ?? 'native-idempotency',
    externalEffect: op.externalEffect ?? true,
  }
}

function readOperation(spec: RestConnectorSpec, name: string, expected: 'read' | 'mutation'): RestOperationSpec {
  const op = spec.capabilities.find((candidate) => candidate.name === name)
  if (!op || op.class !== expected) {
    throw new Error(`${spec.kind}: unknown ${expected} capability ${name}`)
  }
  return op
}

// The JSON-Schema `required` array names the arguments a caller MUST supply.
// Body rendering uses it to decide which standalone `{placeholder}` body fields
// throw on absence (required) versus get omitted (optional).
function requiredArgsOf(parameters: Record<string, unknown>): readonly string[] | undefined {
  const required = (parameters as { required?: unknown }).required
  return Array.isArray(required) ? required.filter((entry): entry is string => typeof entry === 'string') : undefined
}

/**
 * One transport result. `outcome` is absent on a normal success; when present
 * it names a non-commit the caller must not treat as a write. It lives beside
 * `data` rather than inside it so an upstream field can never be mistaken for
 * a transport tag, and so `data` is always the upstream's own parsed body.
 */
export interface RestTransportResponse {
  data: unknown
  etag?: string
  outcome?: 'conflict' | 'rate-limited'
  /** HTTP status that produced a tagged `outcome` (409/412/429). */
  status?: number
  /** Upstream's error text, kept verbatim for the caller's message. */
  message?: string
  /** Resolved from `Retry-After` on a 429. */
  retryAfterMs?: number
}

/**
 * Map a transport response onto the mutation contract. A CAS conflict
 * (409/412) and a throttle (429) are NOT commits — reporting them under
 * `status: 'committed'` told the caller a write landed when nothing was
 * written, so the caller skipped its retry and the record silently never
 * existed. Shared so hand-rolled adapters that call `executeRestRequest`
 * directly (e.g. Notion's partial update) apply the same rule.
 */
export function mutationResultFromTransport(displayName: string, response: RestTransportResponse): CapabilityMutationResult {
  if (response.outcome === 'conflict') {
    return {
      status: 'conflict',
      alternatives: [],
      // The upstream's parsed body — the contract calls this "the current
      // authoritative state", so it must be what the provider returned,
      // not the transport's own wrapper.
      currentState: response.data,
      message: response.message || `${displayName} rejected the write on a state conflict`,
    }
  }
  if (response.outcome === 'rate-limited') {
    return {
      status: 'rate-limited',
      retryAfterMs: response.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
      message: response.message || `${displayName} throttled the write`,
    }
  }
  return {
    status: 'committed',
    data: response.data,
    etagAfter: response.etag,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

export async function executeRestRequest(
  spec: RestConnectorSpec,
  request: RestRequestSpec,
  inv: ConnectorInvocation,
  requiredArgs?: readonly string[],
): Promise<RestTransportResponse> {
  const placement = spec.credentialPlacement ?? { kind: 'bearer' }

  // AWS SigV4 binds the target region into the HOST and signs the request body,
  // so the credential bundle has to be resolved up front: the region selects
  // the host before the URL is built, and the serialized body must exist before
  // the signature is computed. Non-AWS placements are unaffected.
  const aws = placement.kind === 'aws-sigv4' ? parseAwsCredentialBundle(inv.source.credentials) : undefined
  const awsRegion = aws ? resolveAwsRegion(aws, inv.source.metadata, placement as { defaultRegion?: string }) : undefined

  let baseUrl = resolveBaseUrl(
    spec.baseUrl,
    inv.source.metadata,
    spec.allowedBaseUrls,
    spec.allowedBaseUrlSuffixes,
    spec.requirePublicHttpsBaseUrl,
  )
  if (aws) baseUrl = applyRegionTemplate(baseUrl, awsRegion!, aws.endpoint)
  // Placeholder scope = the capability's arguments PLUS a reserved
  // `connection.*` namespace reading the connection's own metadata. Some
  // providers pin a tenant/realm/company identifier at connect time and then
  // require it on every request (QuickBooks `realmId` in the path, Xero
  // `xero-tenant-id` as a header). Before this, such a value could only reach
  // the request through `baseUrl.metadataKey` — which cannot serve a header, a
  // query param, or `test`, whose invocation has no arguments at all. Args win
  // on a name clash, so no existing adapter changes behavior.
  const scope = renderScope(inv, aws?.bucket ? { bucket: aws.bucket } : undefined)
  // Make the operation path RELATIVE to the base URL so a base like
  // `https://api.emailit.com/v1` preserves its `/v1` prefix. An absolute path
  // (leading `/`) would otherwise be resolved against the origin and drop
  // every path segment the base URL carries.
  const renderedPath = interpolate(request.path, scope).replace(/^\/+/, '')
  const baseWithSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const url = new URL(renderedPath, baseWithSlash)
  for (const [key, value] of Object.entries(request.query ?? {})) {
    const rendered = renderQueryValue(value, scope)
    if (rendered !== undefined && rendered !== '') url.searchParams.set(key, String(rendered))
  }
  // Some AWS capabilities (Bedrock control-plane) target a different host than
  // the connector's base URL and express it as a `host` request header. `fetch`
  // cannot send a custom Host, so fold it into the URL itself. The header value
  // carries a `{region}` token resolved HERE (not a capability argument), so it
  // must bypass `renderHeaders`/`interpolate` — which would throw on the unknown
  // `{region}` placeholder before we ever get to substitute it.
  const requestHeaders = request.headers ?? {}
  const hostOverride = aws
    ? Object.entries(requestHeaders).find(([key]) => key.toLowerCase() === 'host')?.[1]
    : undefined
  const renderableHeaders = hostOverride
    ? Object.fromEntries(Object.entries(requestHeaders).filter(([key]) => key.toLowerCase() !== 'host'))
    : requestHeaders
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...renderHeaders(spec.defaultHeaders ?? {}, scope, true),
    ...renderHeaders(renderableHeaders, scope),
  }
  const structuredCredentials =
    placement.kind === 'structured-headers' || placement.kind === 'structured-json-body'
      ? readStructuredCredentials(inv.source.credentials, placement.fields)
      : undefined
  if (placement.kind === 'structured-headers') {
    for (const [credentialName, headerName] of Object.entries(placement.fields)) {
      headers[headerName] = structuredCredentials![credentialName]!
    }
  }
  if (hostOverride) url.host = hostOverride.replace(/\{region\}/g, awsRegion!)
  if (inv.expectedEtag) headers['if-match'] = inv.expectedEtag
  // POST/PUT/PATCH always carry a body. DELETE carries one ONLY when the
  // operation explicitly declares `request.body` — some APIs (e.g. UserGems)
  // take the record identifier in a DELETE body. GET never carries a body.
  const sendsBody = request.method !== 'GET' && (request.method !== 'DELETE' || request.body !== undefined)
  // Default content-type case-insensitively: AWS adapters declare a capitalized
  // `Content-Type` in defaultHeaders, and a blind `headers['content-type']`
  // default would add a SECOND, conflicting content-type entry (and corrupt the
  // SigV4 signed-header set).
  if (sendsBody && getHeaderCI(headers, 'content-type') === undefined) {
    headers['content-type'] = 'application/json'
  }
  // Serialize the body before signing — SigV4 hashes the payload into the
  // canonical request.
  let resolvedBody = sendsBody ? resolveBody(request.body, inv.args, scope, requiredArgs) : undefined
  if (placement.kind === 'structured-json-body') {
    if (!resolvedBody || typeof resolvedBody !== 'object' || Array.isArray(resolvedBody)) {
      throw new Error(`${spec.kind}: structured JSON credentials require an object request body`)
    }
    resolvedBody = {
      ...resolvedBody,
      ...Object.fromEntries(
        Object.entries(placement.fields).map(([credentialName, bodyName]) => [
          bodyName,
          structuredCredentials![credentialName],
        ]),
      ),
    }
  }
  const bodyString = sendsBody ? JSON.stringify(resolvedBody) : undefined

  if (placement.kind === 'aws-sigv4') {
    signAwsRequest(headers, url, {
      method: request.method,
      body: bodyString ?? '',
      service: placement.service,
      region: awsRegion!,
      bundle: aws!,
    })
  } else if (placement.kind !== 'structured-headers' && placement.kind !== 'structured-json-body') {
    applyCredentials(headers, url, placement, inv.source.credentials)
  }

  const res = await fetch(url, {
    method: request.method,
    headers,
    body: bodyString,
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`${spec.displayName} rejected credentials (${res.status})`, inv.source.id)
  }
  // A non-commit is reported on the ENVELOPE, never as a `status` field inside
  // the body. Tagging the body meant two things went wrong at once: the
  // upstream's own JSON was discarded in favour of the wrapper (so a caller
  // reading `currentState` got the tag instead of the state), and any
  // connector whose successful 2xx body happens to carry `status: 'conflict'`
  // would have had a landed write reclassified as a failure. ~200 connectors
  // share this transport, so that was a foot-gun waiting on one adapter.
  if (res.status === 409 || res.status === 412) {
    const text = redactCredentialText(await safeErrorText(res), inv.source.credentials)
    return {
      data: parseBodyText(text),
      outcome: 'conflict',
      status: res.status,
      message: text,
      etag: res.headers.get('etag') ?? undefined,
    }
  }
  if (res.status === 429) {
    const text = redactCredentialText(await safeErrorText(res), inv.source.credentials)
    return {
      data: parseBodyText(text),
      outcome: 'rate-limited',
      status: res.status,
      message: text,
      retryAfterMs: retryAfterMsFromHeader(res.headers.get('retry-after')),
    }
  }
  // Existence-probe semantics: 204 = present, 404 = absent. Resolve to an
  // explicit boolean BEFORE the generic success path (which would return a
  // null body for the 204) and BEFORE the `!res.ok` throw (which would surface
  // the 404 as an error). Only 204/404 are special-cased here; every other
  // status falls through to its normal handling, so a real failure (500, 422,
  // an auth 401/403 caught above) still fails loud.
  if (request.existenceCheck && (res.status === 204 || res.status === 404)) {
    return { data: { exists: res.status === 204 } }
  }
  if (!res.ok) {
    const text = redactCredentialText(await safeErrorText(res), inv.source.credentials)
    throw new Error(`${spec.kind} ${request.method} ${url.pathname} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const text = await res.text()
  // Most upstreams return JSON, but some return raw payloads — scrapers
  // (ZenRows, Bright Data Web Unlocker) return HTML/markdown/PDF, a few APIs
  // return plain text. Parse JSON when we can; otherwise surface the raw text
  // under `{ raw }` rather than throwing a SyntaxError on a successful 200.
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text) as unknown
    } catch {
      data = { raw: text }
    }
  }
  return { data, etag: res.headers.get('etag') ?? undefined }
}

function resolveBaseUrl(
  baseUrl: RestConnectorSpec['baseUrl'],
  metadata: Record<string, unknown>,
  allowedBaseUrls?: readonly string[],
  allowedBaseUrlSuffixes?: readonly string[],
  requirePublicHttpsBaseUrl?: boolean,
): string {
  let resolved: string
  if (typeof baseUrl === 'string') {
    resolved = baseUrl
  } else {
    const value = metadata[baseUrl.metadataKey]
    if (typeof value === 'string' && value.trim()) {
      resolved = value
    } else if (baseUrl.fallback) {
      resolved = baseUrl.fallback
    } else {
      throw new Error(`missing metadata.${baseUrl.metadataKey} base URL`)
    }
  }
  const exactAllowed = allowedBaseUrls?.some((candidate) => sameUrl(candidate, resolved)) ?? false
  const suffixAllowed = allowedBaseUrlSuffixes?.some((suffix) => hasHttpsHostnameSuffix(resolved, suffix)) ?? false
  if ((allowedBaseUrls || allowedBaseUrlSuffixes) && !exactAllowed && !suffixAllowed) {
    throw new Error('connection base URL is not an allowed provider endpoint')
  }
  if (requirePublicHttpsBaseUrl && !isPublicHttpsUrl(resolved)) {
    throw new Error('connection base URL must be a public HTTPS endpoint')
  }
  return resolved
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.home.arpa')
    ) {
      return false
    }
    if (isIP(hostname) === 4) return isPublicIpv4(hostname)
    if (isIP(hostname) === 6) return isPublicIpv6(hostname)
    return hostname.includes('.')
  } catch {
    return false
  }
}

function isPublicIpv4(hostname: string): boolean {
  const [first, second] = hostname.split('.').map(Number)
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false
  if (first === 100 && second >= 64 && second <= 127) return false
  if (first === 169 && second === 254) return false
  if (first === 172 && second >= 16 && second <= 31) return false
  if (first === 192 && (second === 0 || second === 168)) return false
  if (first === 198 && (second === 18 || second === 19)) return false
  return true
}

function isPublicIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return !(
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('::ffff:')
  )
}

function hasHttpsHostnameSuffix(value: string, suffix: string): boolean {
  try {
    const url = new URL(value)
    const normalized = suffix.toLowerCase()
    return url.protocol === 'https:' && normalized.startsWith('.') && url.hostname.toLowerCase().endsWith(normalized)
  } catch {
    return false
  }
}

function sameUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href
  } catch {
    return false
  }
}

function applyCredentials(
  headers: Record<string, string>,
  url: URL,
  placement: RestCredentialPlacement,
  credentials: ConnectorCredentials,
): void {
  const token = credentialToken(credentials)
  if (placement.kind === 'bearer') headers.authorization = `Bearer ${token}`
  if (placement.kind === 'basic-api-key') {
    headers.authorization = `Basic ${Buffer.from(`${token}:`).toString('base64')}`
  }
  if (placement.kind === 'header') headers[placement.header] = `${placement.prefix ?? ''}${token}`
  if (placement.kind === 'query') url.searchParams.set(placement.parameter, token)
}

function readStructuredCredentials(
  credentials: ConnectorCredentials,
  fields: Readonly<Record<string, string>>,
): Record<string, string> {
  let values: Record<string, unknown>
  if (credentials.kind === 'custom') {
    values = credentials.values
  } else if (credentials.kind === 'api-key') {
    try {
      const parsed = JSON.parse(credentials.apiKey) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      values = parsed as Record<string, unknown>
    } catch {
      throw new Error('structured credentials require a JSON object in the api-key field')
    }
  } else {
    throw new Error(`structured credentials require custom or api-key credentials, got ${credentials.kind}`)
  }
  return Object.fromEntries(Object.keys(fields).map((name) => {
    const value = values[name]
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`structured credentials are missing ${name}`)
    }
    return [name, value]
  }))
}

function credentialToken(credentials: ConnectorCredentials): string {
  if (credentials.kind === 'oauth2') {
    if (!credentials.accessToken.trim()) {
      throw new Error('declarative REST connectors require a non-empty OAuth access token')
    }
    return credentials.accessToken
  }
  if (credentials.kind === 'api-key') {
    if (!credentials.apiKey.trim()) {
      throw new Error('declarative REST connectors require a non-empty API key')
    }
    return credentials.apiKey
  }
  throw new Error(`declarative REST connectors require oauth2 or api-key credentials, got ${credentials.kind}`)
}

function redactCredentialText(text: string, credentials: ConnectorCredentials): string {
  const candidates = credentials.kind === 'oauth2'
    ? [credentials.accessToken, credentials.refreshToken]
    : credentials.kind === 'api-key'
      ? [credentials.apiKey, ...jsonStringValues(credentials.apiKey)]
      : credentials.kind === 'custom'
        ? Object.values(credentials.values)
      : []
  const secrets = candidates.filter(
    (secret): secret is string => typeof secret === 'string' && secret.length > 0,
  )
  return secrets.reduce<string>(
    (redacted, secret) => redacted.split(secret).join('[REDACTED]'),
    text,
  )
}

function jsonStringValues(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return Object.values(parsed).filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

/** Region precedence for an AWS connection: the credential bundle wins, then
 *  connection `metadata.region`, then the adapter's declared default, then the
 *  AWS global default `us-east-1`. */
function resolveAwsRegion(
  bundle: AwsCredentialBundle,
  metadata: Record<string, unknown>,
  placement: { defaultRegion?: string },
): string {
  if (bundle.region) return bundle.region
  if (typeof metadata.region === 'string' && metadata.region.trim()) return metadata.region
  return placement.defaultRegion ?? 'us-east-1'
}

/** Resolve the effective AWS host: an explicit bundle `endpoint` (S3-compatible
 *  / LocalStack / custom partition) wins outright; otherwise substitute the
 *  region into the adapter's `{region}` host template. */
function applyRegionTemplate(baseUrl: string, region: string, endpoint?: string): string {
  if (endpoint) return endpoint
  return baseUrl.replace(/\{region\}/g, region)
}

/** Case-insensitive header lookup (header names are case-insensitive but the
 *  plain object we build is not). */
function getHeaderCI(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

/** Sign the request in place with SigV4 and attach the resulting AWS headers. */
function signAwsRequest(
  headers: Record<string, string>,
  url: URL,
  opts: { method: string; body: string; service: string; region: string; bundle: AwsCredentialBundle },
): void {
  // Re-serialize the query in AWS canonical form so the bytes on the wire match
  // what we sign. URLSearchParams uses form-encoding (space→'+'), which AWS would
  // canonicalize to %2B and reject; the canonical form emits %20 consistently.
  const canonicalSearch = canonicalizeAwsQuery(url.searchParams)
  url.search = canonicalSearch ? `?${canonicalSearch}` : ''
  // x-amz-content-sha256 is mandatory for S3 and signed by the AWS SDK for every
  // service, so always send + sign it. STS temp creds add x-amz-security-token.
  headers['x-amz-content-sha256'] = hashSha256Hex(opts.body)
  if (opts.bundle.sessionToken) headers['x-amz-security-token'] = opts.bundle.sessionToken
  const signed = signSigV4({
    method: opts.method,
    url,
    headers,
    body: opts.body,
    service: opts.service,
    region: opts.region,
    accessKeyId: opts.bundle.accessKeyId,
    secretAccessKey: opts.bundle.secretAccessKey,
    sessionToken: opts.bundle.sessionToken,
    amzDate: amzDateNow(),
  })
  headers['x-amz-date'] = signed.amzDate
  headers.authorization = signed.authorization
}

/**
 * `body: 'args'` splats the caller's arguments verbatim as the request body,
 * so it MUST use `args` — not the interpolation scope. The scope carries the
 * reserved `connection` namespace, and splatting that would post the
 * connection's metadata to the upstream on every `body: 'args'` connector.
 * Templated bodies (a string or object with `{placeholder}` fields) render
 * against the full scope, so they can reference `{connection.<field>}`.
 */
function resolveBody(
  body: RestRequestSpec['body'],
  args: Record<string, unknown>,
  scope: Record<string, unknown>,
  requiredArgs?: readonly string[],
): unknown {
  if (!body || body === 'args') return args
  if (typeof body === 'string') return renderValue(body, scope, requiredArgs)
  return renderObject(body, scope, requiredArgs)
}

/** Conservative wait when the upstream throttles without saying for how long. */
const DEFAULT_RETRY_AFTER_MS = 60_000
/** Floor for an explicit `Retry-After`. `Retry-After: 0` is legal HTTP and is
 *  sometimes sent when a bucket has already refilled, but honouring it
 *  literally turns a throttle into a busy-loop against the upstream. */
const MIN_RETRY_AFTER_MS = 1_000

/** Parse a non-2xx body without throwing. Preserves the upstream's own JSON so
 *  a conflict can report real state; falls back to the raw text, matching how
 *  the success path handles non-JSON payloads. */
function parseBodyText(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { raw: text }
  }
}

/** `Retry-After` is either a seconds count or an HTTP-date. Absent or
 *  unparseable falls back to {@link DEFAULT_RETRY_AFTER_MS}; any parsed value
 *  is floored at {@link MIN_RETRY_AFTER_MS}. */
function retryAfterMsFromHeader(raw: string | null): number {
  if (typeof raw === 'string' && raw.trim()) {
    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(MIN_RETRY_AFTER_MS, Math.round(seconds * 1000))
    }
    const at = Date.parse(raw)
    if (Number.isFinite(at)) return Math.max(MIN_RETRY_AFTER_MS, at - Date.now())
  }
  return DEFAULT_RETRY_AFTER_MS
}

function renderScope(inv: ConnectorInvocation, credentialDefaults?: Record<string, unknown>): Record<string, unknown> {
  // The connection namespace is applied LAST so it cannot be shadowed by a
  // caller-supplied argument.
  //
  // This is a tenant boundary, not a naming convenience. `{connection.<field>}`
  // carries identifiers pinned when the user connected — QuickBooks' realmId,
  // a company/tenant id — and those decide WHOSE data a request reads. With
  // args spread last, an argument named `connection` redirected the request:
  // a connection pinned to realm 9341454792738105 could be driven to
  // `companyinfo/ATTACKER-REALM` while still presenting that connection's
  // OAuth token. Whether the upstream rejects it is not our boundary to
  // delegate; a value fixed at connect time must not be reachable from
  // per-call arguments, which on this path are model-authored.
  //
  // Safe for existing adapters: no capability template references a bare
  // `{connection}`, and Auth0's `connection` parameter — the only one so
  // named — travels through the `body: 'args'` splat, which resolves against
  // the raw arguments rather than this scope.
  // Credential-derived request defaults are explicitly allowlisted by the
  // caller (currently only the non-secret S3-compatible bucket). Arguments
  // override defaults, while connection metadata remains an unshadowable
  // namespace. Never spread a parsed credential object here: it contains the
  // signing secret and would make it reachable from declarative templates.
  return { ...credentialDefaults, ...inv.args, connection: inv.source.metadata }
}

function renderHeaders(
  headers: Record<string, string>,
  args: Record<string, unknown>,
  rawExact = false,
): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => {
    const exact = value.match(/^\{([a-zA-Z0-9_.-]+)\}$/)
    if (rawExact && exact) return [key, String(readRequiredPath(args, exact[1]))]
    return [key, interpolate(value, args)]
  }))
}

function renderObject(
  input: Record<string, unknown>,
  args: Record<string, unknown>,
  requiredArgs?: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    // A body field whose value is exactly `{placeholder}` is OPTIONAL unless the
    // placeholder is named in the capability's JSON-Schema `required` list:
    //   required → throw on absence (fail fast, preserves existing behavior),
    //   optional → drop the key (mirrors how query params already behave).
    // This stops every enumerated optional body field from becoming de-facto
    // mandatory just because it appears as a `{field}` placeholder.
    if (typeof value === 'string') {
      const exact = value.match(/^\{([a-zA-Z0-9_.-]+)\}$/)
      if (exact) {
        const name = exact[1]
        const resolved = readPath(args, name)
        if (resolved === undefined || resolved === null) {
          if (requiredArgs?.includes(name)) {
            throw new Error(`missing required argument: ${name}`)
          }
          continue
        }
        out[key] = resolved
        continue
      }
    }
    out[key] = renderValue(value, args, requiredArgs)
  }
  return out
}

function renderValue(value: unknown, args: Record<string, unknown>, requiredArgs?: readonly string[]): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\{([a-zA-Z0-9_.-]+)\}$/)
    if (exact) return readRequiredPath(args, exact[1])
    return interpolate(value, args)
  }
  // Recurse into arrays and nested objects so declarative adapters that pass
  // structured request bodies (e.g. JSON:API envelopes, multi-line-item
  // payloads) get their placeholders interpolated, not left as literal
  // "{amount}" strings. Required by billplz/emailit/lemon-squeezy adds.
  if (Array.isArray(value)) {
    return value.map((entry) => renderValue(entry, args, requiredArgs))
  }
  if (value && typeof value === 'object') {
    return renderObject(value as Record<string, unknown>, args, requiredArgs)
  }
  return value
}

function renderQueryValue(value: unknown, args: Record<string, unknown>): unknown {
  if (typeof value !== 'string') return value
  const exact = value.match(/^\{([a-zA-Z0-9_.-]+)\}$/)
  if (exact) return readPath(args, exact[1])
  try {
    return interpolate(value, args)
  } catch {
    return undefined
  }
}

function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) => {
    const value = readPath(args, key)
    if (value === undefined || value === null) {
      throw new Error(`missing required argument: ${key}`)
    }
    return encodeURIComponent(String(value))
  })
}

function readRequiredPath(input: Record<string, unknown>, path: string): unknown {
  const value = readPath(input, path)
  if (value === undefined || value === null) throw new Error(`missing required argument: ${path}`)
  return value
}

function readPath(input: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => {
    if (value && typeof value === 'object' && part in value) {
      return (value as Record<string, unknown>)[part]
    }
    return undefined
  }, input)
}

function readPathFromUnknown(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => {
    if (value && typeof value === 'object' && part in value) {
      return (value as Record<string, unknown>)[part]
    }
    return undefined
  }, input)
}

async function safeErrorText(res: Response): Promise<string> {
  return (await res.text().catch(() => res.statusText)) || res.statusText
}
