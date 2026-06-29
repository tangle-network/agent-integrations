/**
 * AWS Signature Version 4 (SigV4) request signer — self-contained, no SDK.
 *
 * Why this exists: the AWS-family connectors (SQS, SNS, SES, S3, Bedrock,
 * Secrets Manager, Textract, Backblaze B2) authenticate with an
 * `AWS4-HMAC-SHA256` signature, not a bearer token. The declarative-REST
 * runtime calls {@link signSigV4} at fetch time to compute the `Authorization`
 * header from the request (canonical request → string-to-sign → signing key →
 * signature). One signer serves every AWS adapter.
 *
 * Implementation tracks the AWS spec and `@smithy/signature-v4` behavior:
 *   - canonical URI: S3 uses the path verbatim (`uriEscapePath=false`); every
 *     other service normalizes then double-encodes (`encodeURIComponent` of the
 *     already-encoded path, with `%2F` restored to `/`).
 *   - canonical query: RFC-3986 encode each key/value (encodeURIComponent plus
 *     `!'()*`), then sort by encoded key, then encoded value.
 *   - signed headers: `host` + `x-amz-date` are always signed; every header
 *     passed in by the caller is signed too (lowercased, whitespace-collapsed),
 *     so the caller controls the signed set (e.g. S3 requires
 *     `x-amz-content-sha256`).
 *
 * Crypto is `node:crypto` (`createHmac` / `createHash`) to match the rest of
 * this package (guard.ts, webhooks.ts, oauth.ts) and avoid a runtime dep.
 *
 * Correctness is pinned by known-answer vectors from the AWS docs in
 * `tests/aws-sigv4.test.ts` (the IAM `ListUsers` GET example and the S3
 * `GetObject` example), so the signer is provable without live AWS calls.
 */
import { createHash, createHmac } from 'node:crypto'
import type { ConnectorCredentials } from '../types.js'

const ALGORITHM = 'AWS4-HMAC-SHA256'

/** The four (plus two optional) fields an AWS SigV4 signature needs. Carried as
 *  a JSON object inside the connector's single api-key credential field so the
 *  whole change stays in this package (no multi-field credential UI). */
export interface AwsCredentialBundle {
  accessKeyId: string
  secretAccessKey: string
  /** AWS region (e.g. `us-east-1`). May be empty here — the caller resolves a
   *  fallback (connection metadata, adapter default, then `us-east-1`). */
  region: string
  /** STS temporary-credential session token, signed as `x-amz-security-token`. */
  sessionToken?: string
  /** Explicit endpoint override (S3-compatible stores, LocalStack, custom
   *  partitions). Wins over the adapter's region-templated host. */
  endpoint?: string
}

export interface SigV4Input {
  method: string
  /** Fully-resolved request URL. `host`, path, and query are read from here. */
  url: URL
  /** Headers the caller intends to send AND sign. `host`, `x-amz-date`, and
   *  `authorization` are managed by the signer and may be omitted/ignored. */
  headers: Record<string, string>
  /** Serialized request payload (empty string for no body). */
  body: string
  /** SigV4 signing service name (e.g. `sqs`, `s3`, `ses`, `secretsmanager`). */
  service: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  /** Request timestamp in ISO basic format `YYYYMMDDTHHMMSSZ`. Injected so the
   *  signer is deterministic under test; production callers pass
   *  {@link amzDateNow}. */
  amzDate: string
}

export interface SigV4Signature {
  /** `YYYYMMDDTHHMMSSZ` — also the value of the `x-amz-date` header to send. */
  amzDate: string
  /** Semicolon-joined sorted signed-header names. */
  signedHeaders: string
  /** The canonical request, before hashing (exposed for tests/debugging). */
  canonicalRequest: string
  /** The string-to-sign derived from the canonical request hash. */
  stringToSign: string
  /** Lowercase-hex signature. */
  signature: string
  /** The full `Authorization` header value. */
  authorization: string
}

/**
 * Parse the AWS credential bundle carried in the connector's api-key field.
 * Accepts a JSON object with `accessKeyId` / `secretAccessKey` (+ optional
 * `region`, `sessionToken`, `endpoint`); tolerates a few common key aliases.
 * Throws a clear error if the field is not a JSON object or is missing the
 * access-key pair — failing loud at first call rather than producing an
 * unsigned/garbage request.
 */
export function parseAwsCredentialBundle(credentials: ConnectorCredentials): AwsCredentialBundle {
  if (credentials.kind !== 'api-key') {
    throw new Error(`AWS SigV4 connectors require api-key credentials, got ${credentials.kind}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(credentials.apiKey)
  } catch {
    throw new Error(
      'AWS credential must be a JSON object with accessKeyId, secretAccessKey, and region — received a non-JSON string',
    )
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('AWS credential bundle must be a JSON object with accessKeyId, secretAccessKey, and region')
  }
  const o = raw as Record<string, unknown>
  const accessKeyId = pickString(o, ['accessKeyId', 'access_key_id', 'awsAccessKeyId', 'AccessKeyId'])
  const secretAccessKey = pickString(o, [
    'secretAccessKey',
    'secret_access_key',
    'awsSecretAccessKey',
    'SecretAccessKey',
    'secretKey',
  ])
  const region = pickString(o, ['region', 'awsRegion', 'Region']) ?? ''
  const sessionToken = pickString(o, ['sessionToken', 'session_token', 'awsSessionToken', 'SessionToken'])
  const endpoint = pickString(o, ['endpoint', 'Endpoint'])
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credential bundle is missing accessKeyId and/or secretAccessKey')
  }
  return { accessKeyId, secretAccessKey, region, sessionToken, endpoint }
}

/**
 * Compute the SigV4 signature for a request. Pure and deterministic given
 * `amzDate`. `host` and `x-amz-date` are always added to the signed header set;
 * every header in `input.headers` (except `authorization`) is signed as well,
 * so the caller decides the signed set.
 */
export function signSigV4(input: SigV4Input): SigV4Signature {
  const { method, url, body, service, region, accessKeyId, secretAccessKey, sessionToken, amzDate } = input
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = hashSha256Hex(body)

  const headerMap = new Map<string, string>()
  for (const [key, value] of Object.entries(input.headers)) {
    const name = key.toLowerCase().trim()
    if (name === 'authorization') continue
    headerMap.set(name, collapseWhitespace(value))
  }
  // host + x-amz-date are mandatory and authoritative — they reflect what is
  // actually sent, so they overwrite anything the caller passed.
  headerMap.set('host', url.host)
  headerMap.set('x-amz-date', amzDate)
  if (sessionToken) headerMap.set('x-amz-security-token', sessionToken)

  const sortedNames = [...headerMap.keys()].sort()
  const canonicalHeaders = sortedNames.map((name) => `${name}:${headerMap.get(name)}\n`).join('')
  const signedHeaders = sortedNames.join(';')

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(url.pathname, service),
    canonicalizeAwsQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [ALGORITHM, amzDate, credentialScope, hashSha256Hex(canonicalRequest)].join('\n')

  const signingKey = deriveSigningKey(secretAccessKey, dateStamp, region, service)
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')

  const authorization = `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { amzDate, signedHeaders, canonicalRequest, stringToSign, signature, authorization }
}

/** Current time as an ISO basic timestamp `YYYYMMDDTHHMMSSZ`. The optional
 *  `date` argument exists for tests; production passes none. */
export function amzDateNow(date: Date = new Date()): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

/** Lowercase-hex SHA-256 of a UTF-8 string (the AWS payload-hash primitive). */
export function hashSha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------

function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp, 'utf8').digest()
  const kRegion = createHmac('sha256', kDate).update(region, 'utf8').digest()
  const kService = createHmac('sha256', kRegion).update(service, 'utf8').digest()
  return createHmac('sha256', kService).update('aws4_request', 'utf8').digest()
}

/**
 * Canonical URI per SigV4. S3 (and S3-compatible stores) sign the path
 * verbatim; every other service normalizes dot-segments then double-encodes
 * (single `encodeURIComponent` over the already-encoded `url.pathname`, with
 * `%2F` restored to `/`). Mirrors `@smithy/signature-v4` `getCanonicalPath`.
 */
function canonicalUri(pathname: string, service: string): string {
  if (!pathname) return '/'
  if (service === 's3') return pathname
  const segments: string[] = []
  for (const segment of pathname.split('/')) {
    if (segment.length === 0 || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  const normalized = `/${segments.join('/')}${segments.length > 0 && pathname.endsWith('/') ? '/' : ''}`
  // Strict AWS encoding, NOT bare encodeURIComponent: AWS's server-side UriEncode
  // escapes !*'() as well, so leaving them raw here would mismatch the signature
  // for any non-S3 path segment containing those characters.
  return awsUriEncode(normalized).replace(/%2F/g, '/')
}

/**
 * Canonical query string: RFC-3986 percent-encode each key and value, then sort
 * by encoded key (ties broken by encoded value), then join `k=v` with `&`.
 * Exported so the declarative-REST layer can rewrite `url.search` into this same
 * canonical form before sending — otherwise URLSearchParams' form-encoding
 * (space→`+`) would put bytes on the wire that disagree with what we signed.
 */
export function canonicalizeAwsQuery(params: URLSearchParams): string {
  const pairs: Array<[string, string]> = []
  for (const [key, value] of params) {
    pairs.push([awsUriEncode(key), awsUriEncode(value)])
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return pairs.map(([key, value]) => `${key}=${value}`).join('&')
}

/** RFC-3986 unreserved-set encoding: `encodeURIComponent` leaves
 *  `A-Za-z0-9-_.~!*'()` alone; AWS additionally requires `!*'()` encoded. */
function awsUriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** Trim and collapse internal whitespace runs to a single space, per the
 *  canonical-header value rule (our header values never contain quoted spans). */
function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}
