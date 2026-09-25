import { afterEach, describe, expect, it, vi } from 'vitest'
import { phantombusterConnector } from '../phantombuster.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_phantombuster',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'phantombuster',
  label: 'PhantomBuster',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'phantombuster-key' },
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

describe('phantombuster adapter', () => {
  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = phantombusterConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['agents.fetch', 'agents.fetch_all', 'agents.fetch_output', 'agents.launch', 'containers.fetch_output'])
    const reads = phantombusterConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = phantombusterConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['agents.fetch', 'agents.fetch_all', 'agents.fetch_output', 'containers.fetch_output'])
    expect(mutations).toEqual(['agents.launch'])
  })

  it('routes agents.fetch as GET /api/v2/agents/fetch', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await phantombusterConnector.executeRead!({ source, capabilityName: 'agents.fetch', args: {"id":"1234567890123456"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/agents/fetch')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-Phantombuster-Key']).toBe('phantombuster-key')
    expect(url.searchParams.get('id')).toBe('1234567890123456')
  })

  it('routes agents.launch as POST /api/v2/agents/launch', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await phantombusterConnector.executeMutation!({ source, capabilityName: 'agents.launch', args: {"id":"1234567890123456","argument":{"sessionCookie":"abc","numberOfProfiles":10},"bonusArgument":{},"saveArgument":true,"manualLaunch":true}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/agents/launch')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Phantombuster-Key']).toBe('phantombuster-key')
    expect(JSON.parse(String(init.body))).toEqual({"id":"1234567890123456","argument":{"sessionCookie":"abc","numberOfProfiles":10},"bonusArgument":{},"saveArgument":true,"manualLaunch":true})
  })
})
