import { afterEach, describe, expect, it, vi } from 'vitest'
import { builtwithConnector } from '../builtwith.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_builtwith',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'builtwith',
  label: 'BuiltWith',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'builtwith-key' },
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

describe('builtwith adapter', () => {
  it('routes domain.lookup as GET /v22/api.json', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await builtwithConnector.executeRead!({ source, capabilityName: 'domain.lookup', args: {"lookup":"stripe.com"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v22/api.json')
    expect(init.method).toBe('GET')
    expect(url.searchParams.get('KEY')).toBe('builtwith-key')
    expect(url.searchParams.get('LOOKUP')).toBe('stripe.com')
  })
})
