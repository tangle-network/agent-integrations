import { afterEach, describe, expect, it, vi } from 'vitest'
import { modjoConnector } from '../modjo.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_modjo',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'modjo',
  label: 'Modjo',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'modjo-key' },
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

describe('modjo adapter', () => {
  it('routes calls.export as POST /v1/calls/exports', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await modjoConnector.executeRead!({ source, capabilityName: 'calls.export', args: {"page":1,"perPage":20,"transcript":true,"aiSummary":true,"contacts":true}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/calls/exports')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('modjo-key')
    expect(JSON.parse(String(init.body))).toEqual({"pagination":{"page":1,"perPage":20},"relations":{"transcript":true,"aiSummary":true,"contacts":true}})
  })

  it('routes users.list as GET /v1/users', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await modjoConnector.executeRead!({ source, capabilityName: 'users.list', args: {"page":1,"perPage":20}, idempotencyKey: 'op_1' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/users')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('modjo-key')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('perPage')).toBe('20')
  })
})
