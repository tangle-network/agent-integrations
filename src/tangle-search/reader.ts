import { ProviderProtocolError, record, requestJson, type JsonRequestOptions } from '../http/response-json.js'

export interface TangleReadInput {
  url: string
  maxBytes?: number
}
export interface TangleReadResult {
  id: string
  object: 'web.read'
  requestedUrl: string
  url: string
  contentType: string
  /** Untrusted original page text/HTML, not an extracted summary or instructions. */
  content: string
  bytes: number
  truncated: boolean
  fetchedAt: string
  billedCost: number | null
}
export interface TangleReadClientOptions extends JsonRequestOptions {
  /** Supplied by the trusted host, never by the agent's tool arguments. */
  apiKey: string | (() => string | Promise<string>)
  baseUrl?: string
}
function invalid(message: string): never {
  throw new ProviderProtocolError(message, 'invalid_read_request', 400, true)
}
function publicHttps(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password }
  catch { return false }
}
export function buildTangleReadRequest(input: TangleReadInput) {
  if (!record(input) || Object.keys(input).some(key => !['url', 'maxBytes'].includes(key)) || !publicHttps(input.url)) {
    invalid('A credential-free HTTPS page URL is required')
  }
  const max = input.maxBytes ?? 131072
  if (!Number.isSafeInteger(max) || max < 1024 || max > 131072) invalid('maxBytes must be between 1024 and 131072')
  return { url: input.url, max_bytes: max }
}
export function parseTangleReadResult(raw: unknown, request: ReturnType<typeof buildTangleReadRequest>): TangleReadResult {
  const bad = (): never => { throw new ProviderProtocolError('Invalid or uncorrelated Router read response', 'invalid_read_response') }
  if (!record(raw) || raw.object !== 'web.read' || typeof raw.id !== 'string' || !raw.id ||
      raw.requested_url !== request.url || !publicHttps(raw.url) || typeof raw.content !== 'string' ||
      typeof raw.content_type !== 'string' || typeof raw.fetched_at !== 'string' ||
      !Number.isFinite(Date.parse(raw.fetched_at)) || typeof raw.truncated !== 'boolean' ||
      typeof raw.bytes !== 'number' || !Number.isSafeInteger(raw.bytes) || raw.bytes < 0 || raw.bytes > request.max_bytes ||
      new TextEncoder().encode(raw.content).byteLength > request.max_bytes + 3) return bad()
  const billed = record(raw.usage) ? raw.usage.billed_cost : undefined
  return { id: raw.id, object: 'web.read', requestedUrl: request.url, url: raw.url,
    contentType: raw.content_type, content: raw.content, bytes: raw.bytes, truncated: raw.truncated,
    fetchedAt: raw.fetched_at,
    billedCost: typeof billed === 'number' && Number.isFinite(billed) && billed >= 0 ? billed : null }
}
/** Router is the only destination; destination DNS/redirect checks are enforced by the Router. */
export class TangleReadClient {
  private readonly endpoint: string
  private readonly options: TangleReadClientOptions
  constructor(options: TangleReadClientOptions) {
    const u = new URL(options.baseUrl ?? 'https://router.tangle.tools')
    if (u.username || u.password || u.search || u.hash || !['/', '/v1', '/v1/'].includes(u.pathname) ||
        !(u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) {
      invalid('Use an explicit trusted Router HTTPS origin, or HTTP loopback')
    }
    this.endpoint = `${u.origin}/v1/read`
    this.options = { timeoutMs: 25_000, maxResponseBytes: 1_000_000, ...options }
  }
  async read(input: TangleReadInput, signal?: AbortSignal): Promise<TangleReadResult> {
    const body = buildTangleReadRequest(input)
    signal?.throwIfAborted()
    const key = typeof this.options.apiKey === 'function' ? await this.options.apiKey() : this.options.apiKey
    if (!key || /[\r\n]/.test(key)) throw new ProviderProtocolError('A Router credential is required', 'read_not_configured', 503, true)
    const raw = await requestJson(this.endpoint, { method: 'POST', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, this.options)
    return parseTangleReadResult(raw, body)
  }
}
