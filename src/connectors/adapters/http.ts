/**
 * Generic HTTP request connector — the long-tail escape hatch for APIs
 * we have not modeled natively yet.
 *
 * Two capabilities, both arity-loose: `request.fetch` (GET-shaped read) and
 * `request.send` (POST/PUT/PATCH/DELETE-shaped mutation). The agent supplies
 * `url`, `method`, `headers`, `query`, and `body` at invocation time. There
 * is no shared base URL and no shared credential — each call is parameterised
 * end-to-end. If the operator needs authenticated calls against a specific
 * vendor, use that vendor's first-party connector or a `declarativeRest`
 * adapter; this one is for the case where the customer has a one-off URL
 * (an internal monitoring endpoint, a public JSON feed, a probe).
 *
 * Safety posture: the adapter only allows `http:` and `https:` schemes —
 * `file:`, `data:`, `blob:`, `gopher:` and friends are rejected with a
 * descriptive error rather than silently downgraded. This is a thin
 * mitigation, not a full SSRF defence; consumers that expose this adapter
 * to multi-tenant traffic must enforce egress allow-lists at the network
 * layer (the SDK's `IntegrationActionGuard` is the documented hook).
 *
 * Consistency model is `advisory`. We have no idea what semantics the
 * upstream attaches to the request — assume nothing. `request.send` is
 * `cas: 'none'`, `externalEffect: true`: every send may have side effects,
 * and the agent's planner must surface the call for caller confirmation.
 * The idempotency key is forwarded as `Idempotency-Key` so receivers that
 * honour the de-facto Stripe header automatically dedupe; receivers that
 * ignore the header are on the operator.
 */

import {
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorInvocation,
} from '../types.js'

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_TIMEOUT_MS = 60_000
const DEFAULT_TIMEOUT_MS = 15_000

export const httpConnector: ConnectorAdapter = {
  manifest: {
    kind: 'http',
    displayName: 'HTTP Request',
    description:
      'Send an arbitrary HTTP request to any http(s) URL. Useful for hitting one-off APIs, probes, public JSON feeds, or operator-controlled webhooks. No shared auth — the agent supplies the full URL, method, headers, and body at invocation time.',
    auth: { kind: 'none' },
    category: 'webhook',
    defaultConsistencyModel: 'advisory',
    capabilities: [
      {
        name: 'request.fetch',
        class: 'read',
        description:
          'Issue a GET/HEAD/OPTIONS request to a URL. Returns the parsed JSON body if the response Content-Type is application/json, otherwise the raw text. The `etag` of the response (when present) is exposed for downstream conditional reads.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
            method: {
              type: 'string',
              enum: ['GET', 'HEAD', 'OPTIONS'],
              description: 'HTTP verb. Defaults to GET.',
            },
            headers: {
              type: 'object',
              description: 'Optional request headers. Header names are lower-cased before send.',
              additionalProperties: { type: 'string' },
            },
            query: {
              type: 'object',
              description: 'Optional query-string parameters. Values are coerced to string; arrays become repeated keys.',
              additionalProperties: true,
            },
            timeoutMs: {
              type: 'number',
              description: `Per-request timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}, capped at ${MAX_TIMEOUT_MS}.`,
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'request.send',
        class: 'mutation',
        description:
          'Issue a POST/PUT/PATCH/DELETE request to a URL. The agent supplies the body verbatim — pass an object for JSON, a string for raw text. The idempotency key is forwarded as the `Idempotency-Key` header; receivers that honour it (Stripe, Square, many SaaS APIs) dedupe automatically.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Absolute http(s) URL to call.' },
            method: {
              type: 'string',
              enum: ['POST', 'PUT', 'PATCH', 'DELETE'],
              description: 'HTTP verb. Defaults to POST.',
            },
            headers: {
              type: 'object',
              description: 'Optional request headers. Header names are lower-cased before send.',
              additionalProperties: { type: 'string' },
            },
            query: {
              type: 'object',
              description: 'Optional query-string parameters appended to the URL.',
              additionalProperties: true,
            },
            body: {
              description:
                'Request body. Objects are JSON-encoded with `content-type: application/json`; strings are sent verbatim with the caller-supplied content-type (defaulting to text/plain).',
            },
            timeoutMs: {
              type: 'number',
              description: `Per-request timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}, capped at ${MAX_TIMEOUT_MS}.`,
            },
          },
          required: ['url'],
        },
        cas: 'none',
        externalEffect: true,
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const args = (inv.args ?? {}) as Record<string, unknown>
    const method = readMethod(args.method, 'GET', READ_METHODS, 'request.fetch')
    const url = buildUrl(readUrl(args.url), args.query)
    const headers = mergeHeaders(args.headers, inv.idempotencyKey, false, undefined)
    const res = await fetch(url.toString(), {
      method,
      headers,
      signal: AbortSignal.timeout(readTimeout(args.timeoutMs)),
    })
    const data = await parseResponse(res, method)
    if (!res.ok) {
      throw new Error(`http ${method} ${url.toString()} failed: ${res.status} ${truncate(stringify(data), 200)}`)
    }
    return {
      data,
      etag: res.headers.get('etag') ?? undefined,
      fetchedAt: Date.now(),
    }
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const args = (inv.args ?? {}) as Record<string, unknown>
    const method = readMethod(args.method, 'POST', MUTATION_METHODS, 'request.send')
    const url = buildUrl(readUrl(args.url), args.query)
    const { body, contentType } = encodeBody(args.body)
    const headers = mergeHeaders(args.headers, inv.idempotencyKey, true, contentType)
    const res = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(readTimeout(args.timeoutMs)),
    })
    const data = await parseResponse(res, method)
    if (res.status === 409) {
      const message = typeof data === 'object' && data !== null && 'message' in data && typeof (data as Record<string, unknown>).message === 'string'
        ? ((data as Record<string, unknown>).message as string)
        : `http ${method} ${url.toString()} returned 409`
      const alternatives = typeof data === 'object' && data !== null && Array.isArray((data as Record<string, unknown>).alternatives)
        ? ((data as Record<string, unknown>).alternatives as unknown[])
        : []
      return { status: 'conflict', alternatives, message, currentState: data }
    }
    if (res.status === 429) {
      const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'))
      return {
        status: 'rate-limited',
        retryAfterMs: retryAfter,
        message: `http ${method} ${url.toString()} rate-limited; retry after ${retryAfter}ms`,
      }
    }
    if (!res.ok) {
      throw new Error(`http ${method} ${url.toString()} failed: ${res.status} ${truncate(stringify(data), 200)}`)
    }
    return {
      status: 'committed',
      data,
      etagAfter: res.headers.get('etag') ?? undefined,
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test() {
    // Nothing to probe — there is no shared base URL and no credentials.
    // The adapter is healthy as long as the SDK can instantiate it.
    return { ok: true }
  },
}

function readUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('http.url is required')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`http.url is not a valid absolute URL: ${value}`)
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new Error(`http.url scheme not allowed: ${parsed.protocol} (only http: and https: are accepted)`)
  }
  return parsed
}

function readMethod(
  value: unknown,
  fallback: string,
  allowed: Set<string>,
  capability: string,
): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') {
    throw new Error(`http.method must be a string for ${capability}`)
  }
  const upper = value.toUpperCase()
  if (!allowed.has(upper)) {
    throw new Error(
      `http.method ${upper} not allowed for ${capability} (allowed: ${[...allowed].sort().join(', ')})`,
    )
  }
  return upper
}

function readTimeout(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_TIMEOUT_MS
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('http.timeoutMs must be a positive finite number')
  }
  return Math.min(Math.floor(value), MAX_TIMEOUT_MS)
}

function buildUrl(base: URL, query: unknown): URL {
  if (query === undefined || query === null) return base
  if (typeof query !== 'object') {
    throw new Error('http.query must be an object of string/number/boolean values (or arrays of those)')
  }
  const url = new URL(base.toString())
  for (const [key, raw] of Object.entries(query as Record<string, unknown>)) {
    if (raw === undefined || raw === null) continue
    if (Array.isArray(raw)) {
      for (const entry of raw) url.searchParams.append(key, scalarToString(entry, key))
      continue
    }
    url.searchParams.set(key, scalarToString(raw, key))
  }
  return url
}

function scalarToString(value: unknown, key: string): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw new Error(`http.query.${key} must be string, number, boolean, or an array of those`)
}

function mergeHeaders(
  raw: unknown,
  idempotencyKey: string,
  isMutation: boolean,
  bodyContentType: string | undefined,
): Headers {
  const headers = new Headers()
  headers.set('accept', 'application/json, */*;q=0.1')
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'object') {
      throw new Error('http.headers must be an object of string values')
    }
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === undefined || value === null) continue
      if (typeof value !== 'string') {
        throw new Error(`http.headers.${name} must be a string`)
      }
      headers.set(name.toLowerCase(), value)
    }
  }
  if (isMutation) {
    if (bodyContentType && !headers.has('content-type')) {
      headers.set('content-type', bodyContentType)
    }
    if (!headers.has('idempotency-key')) {
      headers.set('idempotency-key', idempotencyKey)
    }
  }
  return headers
}

function encodeBody(raw: unknown): { body: BodyInit | undefined; contentType: string | undefined } {
  if (raw === undefined || raw === null) return { body: undefined, contentType: undefined }
  if (typeof raw === 'string') return { body: raw, contentType: 'text/plain;charset=utf-8' }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return { body: String(raw), contentType: 'text/plain;charset=utf-8' }
  }
  if (raw instanceof ArrayBuffer) return { body: raw, contentType: 'application/octet-stream' }
  if (typeof raw === 'object') {
    return { body: JSON.stringify(raw), contentType: 'application/json' }
  }
  throw new Error(`http.body must be string, number, boolean, object, or ArrayBuffer (got ${typeof raw})`)
}

async function parseResponse(res: Response, method: string): Promise<unknown> {
  if (method === 'HEAD') return null
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    const text = await res.text()
    if (text.length === 0) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return await res.text()
}

function parseRetryAfterMs(header: string | null): number {
  if (!header) return 1_000
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1_000)
  const date = Date.parse(header)
  if (!Number.isFinite(date)) return 1_000
  return Math.max(0, date - Date.now())
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}
