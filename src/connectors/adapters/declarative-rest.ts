import {
  type Capability,
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ConnectorInvocation,
  CredentialsExpired,
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
  | { kind: 'header'; header: string; prefix?: string }
  | { kind: 'query'; parameter: string }
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
      return {
        data: response.data,
        etag: response.etag,
        fetchedAt: Date.now(),
      }
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const op = readOperation(spec, inv.capabilityName, 'mutation')
      const response = await executeRestRequest(spec, op.request, inv, requiredArgsOf(op.parameters))
      return {
        status: 'committed',
        data: response.data,
        etagAfter: response.etag,
        committedAt: Date.now(),
        idempotentReplay: false,
      }
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

export async function executeRestRequest(
  spec: RestConnectorSpec,
  request: RestRequestSpec,
  inv: ConnectorInvocation,
  requiredArgs?: readonly string[],
): Promise<{ data: unknown; etag?: string }> {
  const placement = spec.credentialPlacement ?? { kind: 'bearer' }

  // AWS SigV4 binds the target region into the HOST and signs the request body,
  // so the credential bundle has to be resolved up front: the region selects
  // the host before the URL is built, and the serialized body must exist before
  // the signature is computed. Non-AWS placements are unaffected.
  const aws = placement.kind === 'aws-sigv4' ? parseAwsCredentialBundle(inv.source.credentials) : undefined
  const awsRegion = aws ? resolveAwsRegion(aws, inv.source.metadata, placement as { defaultRegion?: string }) : undefined

  let baseUrl = resolveBaseUrl(spec.baseUrl, inv.source.metadata)
  if (aws) baseUrl = applyRegionTemplate(baseUrl, awsRegion!, aws.endpoint)
  // Make the operation path RELATIVE to the base URL so a base like
  // `https://api.emailit.com/v1` preserves its `/v1` prefix. An absolute path
  // (leading `/`) would otherwise be resolved against the origin and drop
  // every path segment the base URL carries.
  const renderedPath = interpolate(request.path, inv.args).replace(/^\/+/, '')
  const baseWithSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const url = new URL(renderedPath, baseWithSlash)
  for (const [key, value] of Object.entries(request.query ?? {})) {
    const rendered = renderQueryValue(value, inv.args)
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
    ...spec.defaultHeaders,
    ...renderHeaders(renderableHeaders, inv.args),
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
  const bodyString = sendsBody ? JSON.stringify(resolveBody(request.body, inv.args, requiredArgs)) : undefined

  if (placement.kind === 'aws-sigv4') {
    signAwsRequest(headers, url, {
      method: request.method,
      body: bodyString ?? '',
      service: placement.service,
      region: awsRegion!,
      bundle: aws!,
    })
  } else {
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
  if (res.status === 409 || res.status === 412) {
    return {
      data: {
        status: 'conflict',
        message: await safeErrorText(res),
      },
      etag: res.headers.get('etag') ?? undefined,
    }
  }
  if (res.status === 429) {
    return {
      data: {
        status: 'rate-limited',
        retryAfter: res.headers.get('retry-after') ?? undefined,
        message: await safeErrorText(res),
      },
    }
  }
  if (!res.ok) {
    throw new Error(`${spec.kind} ${request.method} ${url.pathname} HTTP ${res.status}: ${(await safeErrorText(res)).slice(0, 300)}`)
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

function resolveBaseUrl(baseUrl: RestConnectorSpec['baseUrl'], metadata: Record<string, unknown>): string {
  if (typeof baseUrl === 'string') return baseUrl
  const value = metadata[baseUrl.metadataKey]
  if (typeof value === 'string' && value.trim()) return value
  if (baseUrl.fallback) return baseUrl.fallback
  throw new Error(`missing metadata.${baseUrl.metadataKey} base URL`)
}

function applyCredentials(
  headers: Record<string, string>,
  url: URL,
  placement: RestCredentialPlacement,
  credentials: ConnectorCredentials,
): void {
  const token = credentialToken(credentials)
  if (placement.kind === 'bearer') headers.authorization = `Bearer ${token}`
  if (placement.kind === 'header') headers[placement.header] = `${placement.prefix ?? ''}${token}`
  if (placement.kind === 'query') url.searchParams.set(placement.parameter, token)
}

function credentialToken(credentials: ConnectorCredentials): string {
  if (credentials.kind === 'oauth2') return credentials.accessToken
  if (credentials.kind === 'api-key') return credentials.apiKey
  throw new Error(`declarative REST connectors require oauth2 or api-key credentials, got ${credentials.kind}`)
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

function resolveBody(
  body: RestRequestSpec['body'],
  args: Record<string, unknown>,
  requiredArgs?: readonly string[],
): unknown {
  if (!body || body === 'args') return args
  if (typeof body === 'string') return renderValue(body, args, requiredArgs)
  return renderObject(body, args, requiredArgs)
}

function renderHeaders(headers: Record<string, string>, args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, interpolate(value, args)]))
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
