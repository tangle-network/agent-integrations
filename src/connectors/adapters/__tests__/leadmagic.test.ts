import { afterEach, describe, expect, it, vi } from 'vitest'
import { leadmagicConnector } from '../leadmagic.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_leadmagic',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'leadmagic',
  label: 'LeadMagic',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'leadmagic-key' },
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

describe('leadmagic adapter', () => {
  it('routes credits.get as GET /v1/credits', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await leadmagicConnector.executeRead!({ source, capabilityName: 'credits.get', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/credits')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('leadmagic-key')
  })
})
