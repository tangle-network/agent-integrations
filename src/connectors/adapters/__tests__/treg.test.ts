import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTregCaches, tregConnector } from '../treg.js'
import { InvalidCapabilityArgument, ProviderConfigError, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'hubconn_treg_abc',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'treg',
  label: 'treg',
  consistencyModel: 'advisory',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'treg-team-key' },
  status: 'active',
}

interface Route { status?: number; body?: unknown; headers?: Record<string, string> }
type Handler = (url: URL, init: RequestInit) => Route

let calls: Array<{ url: URL; init: RequestInit }> = []

function serve(handler: Handler) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    const route = handler(url, init)
    return new Response(route.body === undefined ? '' : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json', ...route.headers },
    })
  }))
}

const volumeEndpoint = {
  endpoint: { id: 'dataforseo.google.keywords.volume', provider: 'dataforseo', provider_display: 'DataForSEO', method: 'POST', kind: 'data', cost: { usd: 0.09 } },
}
const postEndpoint = { endpoint: { id: 'linkedin.linkedin.user.post.create', provider: 'linkedin', method: 'POST', kind: 'action' } }

function headers(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>
}

function baseHandler(extra: (url: URL, init: RequestInit) => Route | undefined = () => undefined): Handler {
  const budgets: Array<Record<string, unknown>> = []
  let dims = ['customer']
  return (url, init) => {
    const custom = extra(url, init)
    if (custom) return custom
    const method = init.method ?? 'GET'
    if (url.pathname === '/orgs') return { body: [{ org_id: 7, active: true }] }
    if (url.pathname === '/orgs/7/settings' && method === 'GET') return { body: { budget_dims: dims } }
    if (url.pathname === '/orgs/7/settings' && method === 'PATCH') {
      dims = (JSON.parse(String(init.body)) as { budget_dims: string[] }).budget_dims
      return { body: { budget_dims: dims } }
    }
    if (url.pathname === '/orgs/7/budgets') return { body: budgets }
    if (url.pathname.startsWith('/orgs/7/budgets/') && method === 'PUT') {
      const [, , , , dim, val] = url.pathname.split('/')
      budgets.push({ dim, val, ...(JSON.parse(String(init.body)) as object) })
      return { body: budgets.at(-1) }
    }
    if (url.pathname === '/catalog/endpoints/dataforseo.google.keywords.volume') return { body: volumeEndpoint }
    if (url.pathname === '/catalog/endpoints/linkedin.linkedin.user.post.create') return { body: postEndpoint }
    if (url.pathname.startsWith('/call/')) {
      return { body: { tasks: [{ status_code: 20000 }] }, headers: { 'x-treg-cost-micro': '90000', 'x-treg-call-id': 'call_1' } }
    }
    return { status: 404, body: { detail: 'not found' } }
  }
}

beforeEach(() => resetTregCaches())
afterEach(() => vi.restoreAllMocks())

describe('treg adapter', () => {
  it('installs the default daily cap before the first metered call and tags the call with it', async () => {
    serve(baseHandler())
    const result = await tregConnector.executeRead!({
      source, capabilityName: 'call', idempotencyKey: 'op_1',
      args: { endpointId: 'dataforseo.google.keywords.volume', body: [{ keywords: ['ai agent sandbox'], location_code: 2840 }] },
    })

    const put = calls.find((call) => call.init.method === 'PUT')!
    expect(put.url.pathname).toBe('/orgs/7/budgets/hub_daily_cap/hubconn_treg_abc')
    expect(JSON.parse(String(put.init.body))).toMatchObject({ daily_cap_micro: 1_000_000 })
    const patch = calls.find((call) => call.init.method === 'PATCH')!
    expect(JSON.parse(String(patch.init.body))).toEqual({ budget_dims: ['customer', 'hub_daily_cap'] })

    const call = calls.find((item) => item.url.pathname.startsWith('/call/'))!
    expect(call.url.pathname).toBe('/call/dataforseo.google.keywords.volume')
    expect(call.init.method).toBe('POST')
    expect(headers(call.init)).toMatchObject({
      'X-Treg-Token': 'treg-team-key',
      'X-Treg-Meta': 'hub_daily_cap=hubconn_treg_abc',
      'X-Treg-Route-Max-Cost': '0.25',
      'Idempotency-Key': 'op_1',
    })
    expect(JSON.parse(String(call.init.body))).toEqual([{ keywords: ['ai agent sandbox'], location_code: 2840 }])
    expect(result.data).toMatchObject({ costUsd: 0.09, callId: 'call_1', provider: 'DataForSEO' })
    expect((result.data as { citation: string }).citation).toMatch(/^DataForSEO via treg\.to \(dataforseo\.google\.keywords\.volume, call call_1\), \d{4}-\d{2}-\d{2}$/)
  })

  it('keeps an existing cap and does not rewrite it', async () => {
    serve(baseHandler((url) => url.pathname === '/orgs/7/budgets'
      ? { body: [{ dim: 'hub_daily_cap', val: 'hubconn_treg_abc', daily_cap_micro: 5_000_000 }] }
      : undefined))
    await tregConnector.executeRead!({ source, capabilityName: 'call', idempotencyKey: 'op_2', args: { endpointId: 'dataforseo.google.keywords.volume', body: [] } })
    expect(calls.some((call) => call.init.method === 'PUT' || call.init.method === 'PATCH')).toBe(false)
  })

  it('turns a spent daily cap into a refusal that names the approval path', async () => {
    serve(baseHandler((url) => url.pathname.startsWith('/call/')
      ? { status: 429, body: { detail: { error: 'tag_spend_cap_reached', spent_micro: 990_000, cap_micro: 1_000_000 } } }
      : undefined))
    const error = await tregConnector.executeRead!({ source, capabilityName: 'call', idempotencyKey: 'op_3', args: { endpointId: 'dataforseo.google.keywords.volume', body: [] } })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderConfigError)
    expect((error as ProviderConfigError).reason).toBe('daily_cap_reached')
    expect((error as Error).message).toContain('call.overCap')
    expect((error as Error).message).toContain('$0.99 of its $1 daily cap')
  })

  it('reports a per-call ceiling refusal as uncharged', async () => {
    serve(baseHandler((url) => url.pathname.startsWith('/call/')
      ? { status: 402, body: { detail: { error: 'route_max_cost', estimated_cost_micro: 90_000 } } }
      : undefined))
    const error = await tregConnector.executeRead!({ source, capabilityName: 'call', idempotencyKey: 'op_4', args: { endpointId: 'dataforseo.google.keywords.volume', body: [], maxCostUsd: 0.01 } })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InvalidCapabilityArgument)
    expect((error as Error).message).toContain('Nothing was charged')
    expect(headers(calls.at(-1)!.init)['X-Treg-Route-Max-Cost']).toBe('0.01')
  })

  it('refuses a ceiling above one dollar before any request', async () => {
    serve(baseHandler())
    await expect(tregConnector.executeRead!({ source, capabilityName: 'call', idempotencyKey: 'op_5', args: { endpointId: 'dataforseo.google.keywords.volume', maxCostUsd: 5 } }))
      .rejects.toBeInstanceOf(InvalidCapabilityArgument)
    expect(calls).toHaveLength(0)
  })

  it('refuses write endpoints on the read path and runs them only as call.write', async () => {
    serve(baseHandler())
    await expect(tregConnector.executeRead!({ source, capabilityName: 'call', idempotencyKey: 'op_6', args: { endpointId: 'linkedin.linkedin.user.post.create', body: { text: 'hi' } } }))
      .rejects.toThrow(/call\.write/)
    expect(calls.some((call) => call.url.pathname.startsWith('/call/'))).toBe(false)

    const result = await tregConnector.executeMutation!({ source, capabilityName: 'call.write', idempotencyKey: 'op_7', args: { endpointId: 'linkedin.linkedin.user.post.create', body: { text: 'hi' } } })
    expect(result.status).toBe('committed')
    expect(headers(calls.at(-1)!.init)['X-Treg-Meta']).toBe('hub_write=hubconn_treg_abc')
  })

  it('runs an approved over-cap call under its own tag without the cap check', async () => {
    serve(baseHandler())
    await tregConnector.executeMutation!({ source, capabilityName: 'call.overCap', idempotencyKey: 'op_8', args: { endpointId: 'dataforseo.google.keywords.volume', body: [] } })
    expect(calls.some((call) => call.url.pathname.includes('/budgets'))).toBe(false)
    expect(headers(calls.at(-1)!.init)['X-Treg-Meta']).toBe('hub_over_cap=hubconn_treg_abc')
  })

  it('sets the cap only within bounds', async () => {
    serve(baseHandler())
    const result = await tregConnector.executeMutation!({ source, capabilityName: 'cap.set', idempotencyKey: 'op_9', args: { dailyCapUsd: 2.5 } })
    expect(result).toMatchObject({ status: 'committed', data: { dailyCapUsd: 2.5 } })
    await expect(tregConnector.executeMutation!({ source, capabilityName: 'cap.set', idempotencyKey: 'op_10', args: { dailyCapUsd: 1000 } }))
      .rejects.toBeInstanceOf(InvalidCapabilityArgument)
  })

  it('reports today\'s spend for this connection only', async () => {
    serve(baseHandler((url) => {
      if (url.pathname === '/orgs/7/budgets') return { body: [{ dim: 'hub_daily_cap', val: 'hubconn_treg_abc', daily_cap_micro: 2_000_000 }] }
      if (url.pathname === '/orgs/7/usage/by-tag') {
        return { body: { rows: [{ value: 'other', charged_micro: 900_000 }, { value: 'hubconn_treg_abc', charged_micro: 250_000 }] } }
      }
      if (url.pathname === '/orgs/7/balance') return { body: { balance_micro: 4_000_000 } }
      return undefined
    }))
    const result = await tregConnector.executeRead!({ source, capabilityName: 'spend.status', idempotencyKey: 'op_11', args: {} })
    expect(result.data).toMatchObject({ dailyCapUsd: 2, spentTodayUsd: 0.25, remainingTodayUsd: 1.75, balanceUsd: 4 })
    expect(calls.find((call) => call.url.pathname === '/orgs/7/usage/by-tag')!.url.searchParams.get('key')).toBe('hub_daily_cap')
  })

  it('fails the health check on a rejected key', async () => {
    serve(() => ({ status: 401, body: { detail: 'invalid token' } }))
    await expect(tregConnector.test(source)).resolves.toMatchObject({ ok: false })
  })
})
