import { afterEach, describe, expect, it, vi } from 'vitest'
import { lagrowthmachineConnector } from '../lagrowthmachine.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_lagrowthmachine',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'lagrowthmachine',
  label: 'LaGrowthMachine',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'lagrowthmachine-key' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('lagrowthmachine adapter', () => {
  it('routes campaigns.list as GET /flow/campaigns', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await lagrowthmachineConnector.executeRead!({ source, capabilityName: 'campaigns.list', args: {"skip":0,"limit":25}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/flow/campaigns')
    expect(init.method).toBe('GET')
    expect(url.searchParams.get('apikey')).toBe('lagrowthmachine-key')
    expect(url.searchParams.get('skip')).toBe('0')
    expect(url.searchParams.get('limit')).toBe('25')
  })
})
