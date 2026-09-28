import { ProviderProtocolError, record, requestJson, type JsonRequestOptions } from '../http/response-json.js'
export { ProviderProtocolError } from '../http/response-json.js'
export { TangleReadClient, buildTangleReadRequest, parseTangleReadResult,
  type TangleReadInput, type TangleReadResult, type TangleReadClientOptions } from './reader.js'

/** Router protocol, not provider-specific APIs. New provider IDs require no client release. */
export interface TangleSearchInput {
  query: string
  provider?: string
  maxResults?: number
  searchRecency?: 'day' | 'week' | 'month' | 'year'
  includeDomains?: readonly string[]
  excludeDomains?: readonly string[]
}
export interface TangleSearchHit {
  title: string
  url: string
  snippet?: string
  publishedAt?: string
  score?: number
  source?: string
}
export interface TangleSearchResult {
  id: string
  object: 'search.result'
  provider: string
  query: string
  data: TangleSearchHit[]
  citations: string[]
  usage: { upstream_cost: number | null; billed_cost: number | null }
}
export interface TangleSearchClientOptions extends JsonRequestOptions {
  /** Host-selected credential. Never infer one from a model URL or an agent argument. */
  apiKey: string | (() => string | Promise<string>)
  /** Explicit trusted base: HTTPS, or HTTP loopback for tests/self-hosting. */
  baseUrl?: string
  /** A deployment/evaluation pin wins over a per-call preference. */
  provider?: string
}

function invalid(message: string): never {
  throw new ProviderProtocolError(message, 'invalid_search_request', 400, true)
}
function domains(values: readonly string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined
  if (!Array.isArray(values) || values.length > 50 || values.some(v => typeof v !== 'string' || v.length > 255 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(v))) {
    invalid('Domain filters must be host names, not URLs')
  }
  return [...new Set(values.map(v => v.toLowerCase()))]
}
/** Useful for an existing bounded HTTP transport; never sends a request itself. */
export function buildTangleSearchRequest(input: TangleSearchInput, pinnedProvider?: string) {
  if (!record(input) || typeof input.query !== 'string' || !input.query.trim()) invalid('A search query is required')
  const allowed = new Set(['query', 'provider', 'maxResults', 'searchRecency', 'includeDomains', 'excludeDomains'])
  if (Object.keys(input).some(k => !allowed.has(k))) invalid('Unsupported search option; the Router has no page-offset parameter')
  const max = input.maxResults ?? 20
  if (!Number.isInteger(max) || max < 1 || max > 25) invalid('maxResults must be between 1 and 25')
  const provider = pinnedProvider || input.provider
  if (provider !== undefined && (typeof provider !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(provider))) invalid('Invalid Router provider ID')
  if (input.searchRecency !== undefined && !['day', 'week', 'month', 'year'].includes(input.searchRecency)) invalid('Unsupported search recency')
  return { query: input.query.trim(), max_results: max,
    ...(provider ? { provider } : {}), ...(input.searchRecency ? { search_recency: input.searchRecency } : {}),
    ...(input.includeDomains ? { include_domains: domains(input.includeDomains) } : {}),
    ...(input.excludeDomains ? { exclude_domains: domains(input.excludeDomains) } : {}) }
}
function safeURL(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password }
  catch { return false }
}
/** Correlate a response without inventing pagination, images, stock or missing costs. */
export function parseTangleSearchResult(raw: unknown, request: { query: string; provider?: string }): TangleSearchResult {
  const bad = () => { throw new ProviderProtocolError('Invalid or uncorrelated Router search response', 'invalid_search_response') }
  if (!record(raw) || raw.object !== 'search.result' || typeof raw.id !== 'string' || !raw.id ||
    typeof raw.provider !== 'string' || !raw.provider || raw.query !== request.query || !Array.isArray(raw.data)) return bad()
  if (request.provider && raw.provider !== request.provider) {
    throw new ProviderProtocolError('Router served a different search provider than requested', 'search_provider_mismatch')
  }
  const hits: TangleSearchHit[] = raw.data.map(hit => {
    if (!record(hit) || !safeURL(hit.url) || typeof hit.title !== 'string' ||
      (hit.snippet !== undefined && typeof hit.snippet !== 'string')) return bad()
    return { url: hit.url, title: hit.title, ...(typeof hit.snippet === 'string' ? { snippet: hit.snippet } : {}),
      ...(typeof hit.publishedAt === 'string' ? { publishedAt: hit.publishedAt } : {}),
      ...(typeof hit.score === 'number' && Number.isFinite(hit.score) ? { score: hit.score } : {}),
      ...(typeof hit.source === 'string' ? { source: hit.source } : {}) }
  })
  const cost = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
  const usage = record(raw.usage) ? raw.usage : {}
  return { id: raw.id, object: 'search.result', provider: raw.provider, query: request.query, data: hits,
    citations: Array.isArray(raw.citations) ? raw.citations.filter(safeURL) : [],
    usage: { upstream_cost: cost(usage.upstream_cost), billed_cost: cost(usage.billed_cost) } }
}
export class TangleSearchClient {
  private readonly endpoint: string
  private readonly options: TangleSearchClientOptions
  constructor(options: TangleSearchClientOptions) {
    const u = new URL(options.baseUrl ?? 'https://router.tangle.tools')
    if (u.username || u.password || u.search || u.hash || !['/', '/v1', '/v1/'].includes(u.pathname) ||
      !(u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) {
      invalid('Use an explicit trusted Router HTTPS origin, or HTTP loopback')
    }
    this.endpoint = u.origin + '/v1/search'
    this.options = { ...options }
  }
  async search(input: TangleSearchInput, signal?: AbortSignal): Promise<TangleSearchResult> {
    const body = buildTangleSearchRequest(input, this.options.provider)
    signal?.throwIfAborted()
    const key = typeof this.options.apiKey === 'function' ? await this.options.apiKey() : this.options.apiKey
    if (!key || /[\r\n]/.test(key)) throw new ProviderProtocolError('A Router credential is required', 'search_not_configured', 503, true)
    const raw = await requestJson(this.endpoint, { method: 'POST', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, this.options)
    return parseTangleSearchResult(raw, body)
  }
}
