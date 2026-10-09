/**
 * treg (treg.to) — one prepaid team token for per-call SEO, backlink, keyword,
 * enrichment, social and scraping endpoints. treg holds the provider keys and
 * bills the team's prepaid balance at the provider's listed price, so the
 * connection owner funds every metered call.
 *
 * Spend control is enforced by treg itself, not by this stateless adapter:
 *   - every metered read carries `X-Treg-Route-Max-Cost` (default $0.25, at
 *     most $1), which treg refuses with 402 before spending;
 *   - every metered read is tagged `hub_daily_cap=<connection>` and treg holds
 *     a per-day budget on that tag. When the day's budget is spent treg answers
 *     429 `tag_spend_cap_reached`; the agent then needs `call.overCap`, a
 *     mutation the Hub gates behind owner approval or a standing grant.
 *   - the first metered read installs a $1/day budget when the connection has
 *     none. `cap.set` changes it, also through owner approval.
 *
 * Catalog endpoints that act on the world (`kind` other than data, routed or
 * utility: posting, ads changes, media generation) are refused on the read
 * path and run only through `call.write`.
 */

import {
  type Capability,
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorInvocation,
  type ResolvedDataSource,
  CredentialsExpired,
  InvalidCapabilityArgument,
  ProviderConfigError,
  ProviderRequestError,
} from '../types.js'

const TREG_BASE_URL = 'https://treg.to'
const REQUEST_TIMEOUT_MS = 120_000
const CONTROL_TIMEOUT_MS = 15_000
export const TREG_CAP_DIMENSION = 'hub_daily_cap'
export const TREG_OVER_CAP_DIMENSION = 'hub_over_cap'
export const TREG_WRITE_DIMENSION = 'hub_write'
export const TREG_DEFAULT_DAILY_CAP_USD = 1
export const TREG_DEFAULT_MAX_COST_USD = 0.25
export const TREG_MAX_COST_CEILING_USD = 1
const TREG_MAX_DAILY_CAP_USD = 100
const READ_KINDS = new Set(['data', 'routed', 'utility'])
const CAP_CHECK_TTL_MS = 10 * 60_000
const CATALOG_TTL_MS = 60 * 60_000
const MAX_BUDGET_DIMENSIONS = 3

const callParameters = {
  type: 'object',
  properties: {
    endpointId: { type: 'string', description: 'Catalog endpoint id from catalog.search, e.g. "dataforseo.google.keywords.volume".' },
    method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method from catalog.get; defaults to the endpoint\'s method.' },
    query: {
      type: 'object',
      additionalProperties: { type: ['string', 'number', 'boolean'] },
      description: 'Query parameters the endpoint declares (catalog.get input.queryParams).',
    },
    body: { type: ['object', 'array'], description: 'JSON body the endpoint declares (catalog.get input.body).' },
    maxCostUsd: {
      type: 'number',
      exclusiveMinimum: 0,
      maximum: TREG_MAX_COST_CEILING_USD,
      description: `Refuse before spending when treg's reserve for this call exceeds this many dollars. Default ${TREG_DEFAULT_MAX_COST_USD}, at most ${TREG_MAX_COST_CEILING_USD}.`,
    },
  },
  required: ['endpointId'],
} as const

const capabilities: Capability[] = [
  {
    name: 'catalog.search',
    class: 'read',
    description: 'Find treg catalog endpoints by the job to do ("keyword search volume", "backlinks for a domain", "company enrichment by domain"). Returns ids, providers, listed price, observed success rate and median latency. Free.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 200, description: 'What the call should do, in plain words.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Results to return (default 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'catalog.get',
    class: 'read',
    description: 'Read one catalog endpoint in full before calling it: method, query and body parameters, price unit, example call and sibling providers. Free.',
    parameters: {
      type: 'object',
      properties: { endpointId: { type: 'string', description: 'Catalog endpoint id.' } },
      required: ['endpointId'],
    },
  },
  {
    name: 'spend.status',
    class: 'read',
    description: 'Today\'s spend for this connection against its daily cap (UTC day), and the team\'s remaining prepaid balance. Free.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'call',
    class: 'read',
    description: 'Call one read-only catalog endpoint (keyword volume, backlinks, enrichment, SERP, scraping) on the connection owner\'s prepaid treg balance. Counts toward the connection\'s daily cap; when the cap is spent the call fails with daily_cap_reached and only call.overCap, which needs owner approval, can continue. Returns the provider\'s response with the charge, call id and a citation line.',
    parameters: callParameters,
    consistencyModel: 'advisory',
  },
  {
    name: 'call.overCap',
    class: 'mutation',
    description: 'Make one read-only catalog call after today\'s daily cap is spent. Runs only after the owner approves it or grants a standing permission. Same inputs and output as call.',
    parameters: callParameters,
    cas: 'native-idempotency',
    externalEffect: true,
    consistencyModel: 'advisory',
  },
  {
    name: 'call.write',
    class: 'mutation',
    description: 'Call a catalog endpoint that acts on the world: posts, ad changes, media generation or another action endpoint. Every call needs owner approval unless the owner granted one. Same inputs and output as call.',
    parameters: callParameters,
    cas: 'native-idempotency',
    externalEffect: true,
    consistencyModel: 'advisory',
  },
  {
    name: 'cap.set',
    class: 'mutation',
    description: `Set this connection's daily spend cap in US dollars (UTC day, ${TREG_DEFAULT_DAILY_CAP_USD} by default). Needs owner approval and an owner or admin treg key.`,
    parameters: {
      type: 'object',
      properties: {
        dailyCapUsd: { type: 'number', exclusiveMinimum: 0, maximum: TREG_MAX_DAILY_CAP_USD, description: 'Dollars per UTC day.' },
      },
      required: ['dailyCapUsd'],
    },
    cas: 'native-idempotency',
    externalEffect: false,
  },
]

interface CatalogEndpoint {
  id: string
  provider?: string
  provider_display?: string
  name?: string
  summary?: string
  method?: string
  kind?: string
  cost?: Record<string, unknown> | null
  observed?: Record<string, unknown> | null
  input?: unknown
  call_template?: string
}

const catalogCache = new Map<string, { endpoint: CatalogEndpoint; at: number }>()
const capCheckCache = new Map<string, number>()
const orgCache = new Map<string, number>()

/** Test seam: forget cached catalog entries and cap checks. */
export function resetTregCaches(): void {
  catalogCache.clear()
  capCheckCache.clear()
  orgCache.clear()
}

function token(source: ResolvedDataSource): string {
  if (source.credentials.kind === 'api-key' && source.credentials.apiKey.trim()) return source.credentials.apiKey.trim()
  throw new CredentialsExpired('treg needs a team API key', source.id)
}

function tagValue(source: ResolvedDataSource): string {
  const value = source.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
  if (!value) throw new ProviderConfigError('treg connection id cannot be used as a spend tag', source.id, { status: 400 })
  return value
}

async function treg(
  source: ResolvedDataSource,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json', 'X-Treg-Token': token(source), ...init.headers }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  return fetch(`${TREG_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'manual',
    signal: AbortSignal.timeout(init.timeoutMs ?? CONTROL_TIMEOUT_MS),
  })
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function detail(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && 'detail' in body) {
    const value = (body as { detail: unknown }).detail
    if (value && typeof value === 'object') return value as Record<string, unknown>
    return { message: String(value) }
  }
  return {}
}

async function controlJson<T>(source: ResolvedDataSource, path: string, init: Parameters<typeof treg>[2] = {}): Promise<T> {
  const response = await treg(source, path, init)
  const body = await readBody(response)
  if (response.status === 401) throw new CredentialsExpired('treg rejected the team API key', source.id, { status: 401, body })
  if (response.status === 403) {
    throw new ProviderConfigError(`treg refused ${init.method ?? 'GET'} ${path.split('?')[0]}: ${String(detail(body).message ?? 'needs an owner or admin key')}`,
      source.id, { status: 403, reason: 'treg_role', body })
  }
  if (!response.ok) {
    throw new ProviderRequestError(`treg ${init.method ?? 'GET'} ${path.split('?')[0]} answered HTTP ${response.status}`, source.id, { status: response.status, body })
  }
  return body as T
}

async function orgId(source: ResolvedDataSource): Promise<number> {
  const cached = orgCache.get(source.id)
  if (cached !== undefined) return cached
  const orgs = await controlJson<Array<{ org_id?: number; active?: boolean }>>(source, '/orgs')
  const active = Array.isArray(orgs) ? (orgs.find((org) => org.active) ?? (orgs.length === 1 ? orgs[0] : undefined)) : undefined
  if (typeof active?.org_id !== 'number') {
    throw new ProviderConfigError('treg key does not name exactly one team; create a team API key in treg', source.id, { status: 400, reason: 'treg_team' })
  }
  orgCache.set(source.id, active.org_id)
  return active.org_id
}

async function ensureBudgetDimension(source: ResolvedDataSource, org: number): Promise<void> {
  const settings = await controlJson<{ budget_dims?: string[] }>(source, `/orgs/${org}/settings`)
  const dims = Array.isArray(settings.budget_dims) ? settings.budget_dims : []
  if (dims.includes(TREG_CAP_DIMENSION)) return
  if (dims.length >= MAX_BUDGET_DIMENSIONS) {
    throw new ProviderConfigError(`treg team already budgets ${MAX_BUDGET_DIMENSIONS} tag keys (${dims.join(', ')}); free one for ${TREG_CAP_DIMENSION}`,
      source.id, { status: 409, reason: 'treg_budget_dims' })
  }
  await controlJson(source, `/orgs/${org}/settings`, { method: 'PATCH', body: { budget_dims: [...dims, TREG_CAP_DIMENSION] } })
}

async function setDailyCap(source: ResolvedDataSource, usd: number): Promise<{ dailyCapUsd: number }> {
  const org = await orgId(source)
  await ensureBudgetDimension(source, org)
  const micro = Math.round(usd * 1_000_000)
  await controlJson(source, `/orgs/${org}/budgets/${TREG_CAP_DIMENSION}/${encodeURIComponent(tagValue(source))}`, {
    method: 'PUT',
    body: { daily_cap_micro: micro, note: 'Hub connection daily cap' },
  })
  capCheckCache.set(source.id, Date.now())
  return { dailyCapUsd: micro / 1_000_000 }
}

interface TregBudget { dim?: string; val?: string; daily_cap_micro?: number | null; status?: string }

async function connectionBudget(source: ResolvedDataSource, org: number): Promise<TregBudget | undefined> {
  const budgets = await controlJson<TregBudget[]>(source, `/orgs/${org}/budgets`)
  const value = tagValue(source)
  return Array.isArray(budgets)
    ? budgets.find((budget) => budget.dim === TREG_CAP_DIMENSION && budget.val === value && typeof budget.daily_cap_micro === 'number')
    : undefined
}

/** A metered read never runs without a daily budget on its tag. */
async function ensureDailyCap(source: ResolvedDataSource): Promise<void> {
  const checked = capCheckCache.get(source.id)
  if (checked !== undefined && Date.now() - checked < CAP_CHECK_TTL_MS) return
  const org = await orgId(source)
  if (await connectionBudget(source, org)) {
    capCheckCache.set(source.id, Date.now())
    return
  }
  await setDailyCap(source, TREG_DEFAULT_DAILY_CAP_USD)
}

async function catalogEndpoint(source: ResolvedDataSource, endpointId: string): Promise<CatalogEndpoint> {
  const cached = catalogCache.get(endpointId)
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.endpoint
  const response = await treg(source, `/catalog/endpoints/${encodeURIComponent(endpointId)}`)
  const body = await readBody(response)
  if (response.status === 404) throw new InvalidCapabilityArgument(`treg has no catalog endpoint "${endpointId}"; find one with catalog.search`, 'endpointId')
  if (!response.ok) throw new ProviderRequestError(`treg catalog answered HTTP ${response.status}`, source.id, { status: response.status, body })
  const endpoint = (body as { endpoint?: CatalogEndpoint } | null)?.endpoint
  if (!endpoint || endpoint.id !== endpointId) throw new ProviderRequestError('treg catalog entry is malformed', source.id, { status: 502, body })
  catalogCache.set(endpointId, { endpoint, at: Date.now() })
  return endpoint
}

function stringArg(args: Record<string, unknown>, field: string): string {
  const value = args[field]
  if (typeof value !== 'string' || !value.trim()) throw new InvalidCapabilityArgument(`${field} is required`, field)
  return value.trim()
}

function endpointIdArg(args: Record<string, unknown>): string {
  const id = stringArg(args, 'endpointId')
  if (!/^[a-z0-9][a-z0-9._-]{1,200}$/i.test(id)) throw new InvalidCapabilityArgument('endpointId must be a catalog id such as "moz.web.backlinks.summary"', 'endpointId')
  return id
}

function maxCost(args: Record<string, unknown>): number {
  const value = args.maxCostUsd ?? TREG_DEFAULT_MAX_COST_USD
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > TREG_MAX_COST_CEILING_USD) {
    throw new InvalidCapabilityArgument(`maxCostUsd must be above 0 and at most ${TREG_MAX_COST_CEILING_USD}`, 'maxCostUsd')
  }
  return value
}

function queryString(args: Record<string, unknown>): string {
  const query = args.query
  if (query === undefined || query === null) return ''
  if (typeof query !== 'object' || Array.isArray(query)) throw new InvalidCapabilityArgument('query must be an object of scalar values', 'query')
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new InvalidCapabilityArgument(`query.${key} must be a string, number or boolean`, 'query')
    params.append(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

type CallMode = 'capped' | 'over-cap' | 'write'

const MODE_TAG: Record<CallMode, string> = {
  capped: TREG_CAP_DIMENSION,
  'over-cap': TREG_OVER_CAP_DIMENSION,
  write: TREG_WRITE_DIMENSION,
}

async function catalogCall(inv: ConnectorInvocation, mode: CallMode) {
  const { source, args } = inv
  const endpointId = endpointIdArg(args)
  const ceiling = maxCost(args)
  const endpoint = await catalogEndpoint(source, endpointId)
  const isRead = READ_KINDS.has(String(endpoint.kind ?? ''))
  if (mode !== 'write' && !isRead) {
    throw new InvalidCapabilityArgument(`${endpointId} is a catalog "${endpoint.kind ?? 'unknown'}" endpoint that acts on the world; use call.write, which needs owner approval`, 'endpointId')
  }
  if (mode === 'write' && isRead) {
    throw new InvalidCapabilityArgument(`${endpointId} only reads data; use call`, 'endpointId')
  }
  if (mode === 'capped') await ensureDailyCap(source)
  const method = typeof args.method === 'string' ? args.method.toUpperCase() : (endpoint.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'POST') throw new InvalidCapabilityArgument('method must be GET or POST', 'method')
  if (method === 'GET' && args.body !== undefined) throw new InvalidCapabilityArgument('a GET call takes no body', 'body')
  const response = await treg(source, `/call/${encodeURIComponent(endpointId)}${queryString(args)}`, {
    method,
    body: method === 'POST' ? (args.body ?? {}) : undefined,
    headers: {
      'X-Treg-Route-Max-Cost': String(ceiling),
      'X-Treg-Meta': `${MODE_TAG[mode]}=${tagValue(source)}`,
      'Idempotency-Key': inv.idempotencyKey.slice(0, 200),
    },
    timeoutMs: REQUEST_TIMEOUT_MS,
  })
  const body = await readBody(response)
  const info = detail(body)
  if (response.status === 401) throw new CredentialsExpired('treg rejected the team API key', source.id, { status: 401, body })
  if (response.status === 429 && info.error === 'tag_spend_cap_reached') {
    throw new ProviderConfigError(
      `daily_cap_reached: this connection spent $${micro(info.spent_micro)} of its $${micro(info.cap_micro)} daily cap (resets 00:00 UTC). `
      + 'Use call.overCap for this call, which waits for owner approval, or ask the owner to raise the cap with cap.set.',
      source.id, { status: 429, reason: 'daily_cap_reached', body },
    )
  }
  if (response.status === 429 && info.error === 'platform_daily_cap_reached') {
    throw new ProviderConfigError(`team_daily_cap_reached: ${String(info.message ?? 'the treg team spent its own daily limit')}`,
      source.id, { status: 429, reason: 'team_daily_cap_reached', body })
  }
  if (response.status === 402 && info.error === 'route_max_cost') {
    throw new InvalidCapabilityArgument(
      `max_cost_exceeded: ${endpointId} would reserve about $${micro(info.estimated_cost_micro)}, above maxCostUsd ${ceiling}. Nothing was charged; ask for fewer rows or targets, or raise maxCostUsd (at most ${TREG_MAX_COST_CEILING_USD}).`,
      'maxCostUsd',
    )
  }
  if (response.status === 402) {
    throw new ProviderConfigError(`balance_empty: the treg team balance cannot cover this call; the owner tops up at ${String(info.topup_url ?? 'https://treg.to')}.`,
      source.id, { status: 402, reason: 'balance_empty', body })
  }
  if (!response.ok) {
    throw new ProviderRequestError(`${endpointId} answered HTTP ${response.status}${info.message ? `: ${String(info.message).slice(0, 300)}` : ''}; nothing was charged.`,
      source.id, { status: response.status, reason: typeof info.error === 'string' ? info.error : undefined, body })
  }
  const costMicro = Number(response.headers.get('x-treg-cost-micro') ?? 0) || 0
  const callId = response.headers.get('x-treg-call-id')
  const servedBy = response.headers.get('x-treg-served-by') ?? endpointId
  const fetchedAt = new Date()
  const provider = endpoint.provider_display ?? endpoint.provider ?? endpointId.split('.')[0]
  return {
    endpointId,
    provider,
    servedBy,
    costUsd: costMicro / 1_000_000,
    callId,
    cache: response.headers.get('x-treg-cache'),
    fetchedAt: fetchedAt.toISOString(),
    citation: `${provider} via treg.to (${servedBy}${callId ? `, call ${callId}` : ''}), ${fetchedAt.toISOString().slice(0, 10)}`,
    data: body,
  }
}

function micro(value: unknown): string {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? (number / 1_000_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : '?'
}

function trimEndpoint(endpoint: CatalogEndpoint) {
  return {
    id: endpoint.id,
    provider: endpoint.provider_display ?? endpoint.provider,
    name: endpoint.name,
    summary: endpoint.summary,
    method: endpoint.method,
    kind: endpoint.kind,
    readOnly: READ_KINDS.has(String(endpoint.kind ?? '')),
    cost: endpoint.cost ?? null,
    observed: endpoint.observed ?? null,
  }
}

async function spendStatus(source: ResolvedDataSource) {
  const org = await orgId(source)
  const value = tagValue(source)
  const [budget, usage, balance] = await Promise.all([
    connectionBudget(source, org),
    controlJson<{ rows?: Array<{ value?: string; charged_micro?: number }> }>(source, `/orgs/${org}/usage/by-tag?key=${TREG_CAP_DIMENSION}&days=1`),
    controlJson<{ balance_micro?: number }>(source, `/orgs/${org}/balance`),
  ])
  const spent = usage.rows?.find((row) => row.value === value)?.charged_micro ?? 0
  const cap = budget?.daily_cap_micro ?? null
  return {
    dailyCapUsd: cap === null ? null : cap / 1_000_000,
    spentTodayUsd: spent / 1_000_000,
    remainingTodayUsd: cap === null ? null : Math.max(0, cap - spent) / 1_000_000,
    balanceUsd: typeof balance.balance_micro === 'number' ? balance.balance_micro / 1_000_000 : null,
    day: new Date().toISOString().slice(0, 10),
    resets: '00:00 UTC',
    note: cap === null ? `No cap yet; the first metered call installs $${TREG_DEFAULT_DAILY_CAP_USD}/day.` : undefined,
  }
}

export const tregConnector: ConnectorAdapter = {
  manifest: {
    kind: 'treg',
    displayName: 'treg',
    description: 'Per-call SEO, keyword, backlink, company-enrichment, SERP and scraping data from about 3,800 provider endpoints (DataForSEO, Moz, Serpstat, SE Ranking, Prospeo and more), billed to the connection owner\'s prepaid treg team balance. Each connection has a daily spend cap; spending past it, cap changes and write endpoints need owner approval.',
    auth: {
      kind: 'api-key',
      hint: 'Team API key from treg.to (Team → API keys). The team\'s prepaid balance pays for calls; use an owner or admin key so the connection can keep its daily cap.',
    },
    category: 'market-intelligence',
    defaultConsistencyModel: 'advisory',
    capabilities,
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const { source, args } = inv
    switch (inv.capabilityName) {
      case 'catalog.search': {
        const query = stringArg(args, 'query')
        const limit = typeof args.limit === 'number' ? Math.min(25, Math.max(1, Math.trunc(args.limit))) : 10
        const response = await treg(source, `/catalog/search?q=${encodeURIComponent(query)}&limit=${limit}`)
        const body = await readBody(response) as { results?: CatalogEndpoint[]; total?: number } | null
        if (!response.ok) throw new ProviderRequestError(`treg catalog search answered HTTP ${response.status}`, source.id, { status: response.status, body })
        return { data: { total: body?.total ?? null, results: (body?.results ?? []).slice(0, limit).map(trimEndpoint) }, fetchedAt: Date.now() }
      }
      case 'catalog.get': {
        const endpoint = await catalogEndpoint(source, endpointIdArg(args))
        return { data: { ...trimEndpoint(endpoint), input: endpoint.input ?? null, example: endpoint.call_template ?? null }, fetchedAt: Date.now() }
      }
      case 'spend.status':
        return { data: await spendStatus(source), fetchedAt: Date.now() }
      case 'call':
        return { data: await catalogCall(inv, 'capped'), fetchedAt: Date.now() }
      default:
        throw new InvalidCapabilityArgument(`unknown treg read ${inv.capabilityName}`, 'capabilityName')
    }
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    let data: unknown
    switch (inv.capabilityName) {
      case 'call.overCap':
        data = await catalogCall(inv, 'over-cap')
        break
      case 'call.write':
        data = await catalogCall(inv, 'write')
        break
      case 'cap.set': {
        const usd = inv.args.dailyCapUsd
        if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0 || usd > TREG_MAX_DAILY_CAP_USD) {
          throw new InvalidCapabilityArgument(`dailyCapUsd must be above 0 and at most ${TREG_MAX_DAILY_CAP_USD}`, 'dailyCapUsd')
        }
        data = await setDailyCap(inv.source, usd)
        break
      }
      default:
        throw new InvalidCapabilityArgument(`unknown treg mutation ${inv.capabilityName}`, 'capabilityName')
    }
    return { status: 'committed', data, committedAt: Date.now(), idempotentReplay: false }
  },

  async test(source) {
    try {
      await orgId(source)
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  },
}
