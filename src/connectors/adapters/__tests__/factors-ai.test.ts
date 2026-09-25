import { afterEach, describe, expect, it, vi } from 'vitest'
import { factorsAiConnector } from '../factors-ai.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_factors_ai',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'factors-ai',
  label: 'Factors.ai',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'factors-ai-key' },
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

describe('factors-ai adapter', () => {
  it('routes account.journey as GET /open/v1/account/factors.ai/journey', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await factorsAiConnector.executeRead!({ source, capabilityName: 'account.journey', args: {"account_domain":"factors.ai","from":"2026-06-01","to":"2026-06-18"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/open/v1/account/factors.ai/journey')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer factors-ai-key')
    expect(url.searchParams.get('from')).toBe('2026-06-01')
    expect(url.searchParams.get('to')).toBe('2026-06-18')
  })
})
