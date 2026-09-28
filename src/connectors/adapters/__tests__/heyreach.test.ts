import { afterEach, describe, expect, it, vi } from 'vitest'
import { heyreachConnector } from '../heyreach.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_heyreach',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'heyreach',
  label: 'HeyReach',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'heyreach-key' },
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

describe('heyreach adapter', () => {
  it('routes campaign.list as POST /api/public/campaign/GetAll', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await heyreachConnector.executeRead!({ source, capabilityName: 'campaign.list', args: {"offset":0,"limit":10}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/public/campaign/GetAll')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('heyreach-key')
    expect(JSON.parse(String(init.body))).toEqual({"offset":0,"limit":10})
  })
})
