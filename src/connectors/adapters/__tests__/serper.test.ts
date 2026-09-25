import { afterEach, describe, expect, it, vi } from 'vitest'
import { serperConnector } from '../serper.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_serper',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'serper',
  label: 'Serper',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'serper-key' },
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

describe('serper adapter', () => {
  it('routes search.web as POST /search', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await serperConnector.executeRead!({ source, capabilityName: 'search.web', args: {"q":"stripe pricing","gl":"us","hl":"en","num":1,"page":1}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/search')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('serper-key')
    expect(JSON.parse(String(init.body))).toEqual({"q":"stripe pricing","gl":"us","hl":"en","num":1,"page":1})
  })
})
