import { afterEach, describe, expect, it, vi } from 'vitest'
import { hightouchConnector } from '../hightouch.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_hightouch',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'hightouch',
  label: 'Hightouch',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'hightouch-key' },
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

describe('hightouch adapter', () => {
  it('routes syncs.list as GET /api/v1/syncs', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await hightouchConnector.executeRead!({ source, capabilityName: 'syncs.list', args: {"limit":25}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v1/syncs')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer hightouch-key')
    expect(url.searchParams.get('limit')).toBe('25')
  })

  it('routes syncs.trigger as POST /api/v1/syncs/123/trigger', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await hightouchConnector.executeMutation!({ source, capabilityName: 'syncs.trigger', args: {"syncId":"123","fullResync":false,"resetCDC":true}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v1/syncs/123/trigger')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer hightouch-key')
    expect(JSON.parse(String(init.body))).toEqual({"fullResync":false,"resetCDC":true})
  })
})
