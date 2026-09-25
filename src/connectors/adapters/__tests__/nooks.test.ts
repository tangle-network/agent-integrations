import { afterEach, describe, expect, it, vi } from 'vitest'
import { nooksConnector } from '../nooks.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_nooks',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'nooks',
  label: 'Nooks',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'nooks-key' },
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

describe('nooks adapter', () => {
  it('routes accounts.list as GET /v1/accounts', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await nooksConnector.executeRead!({ source, capabilityName: 'accounts.list', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/accounts')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer nooks-key')
  })
})
