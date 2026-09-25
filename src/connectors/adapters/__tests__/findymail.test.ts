import { afterEach, describe, expect, it, vi } from 'vitest'
import { findymailConnector } from '../findymail.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_findymail',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'findymail',
  label: 'Findymail',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'findymail-key' },
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

describe('findymail adapter', () => {
  it('routes credits.get as GET /api/credits', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await findymailConnector.executeRead!({ source, capabilityName: 'credits.get', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/credits')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer findymail-key')
  })

  it('routes email.find as POST /api/search/name', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await findymailConnector.executeMutation!({ source, capabilityName: 'email.find', args: {"name":"Patrick Collison","domain":"stripe.com"}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/search/name')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer findymail-key')
    expect(JSON.parse(String(init.body))).toEqual({"name":"Patrick Collison","domain":"stripe.com"})
  })
})
