import { afterEach, describe, expect, it, vi } from 'vitest'
import { wizaConnector } from '../wiza.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_wiza',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'wiza',
  label: 'Wiza',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'wiza-key' },
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

describe('wiza adapter', () => {
  it('routes credits.get as GET /api/meta/credits', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await wizaConnector.executeRead!({ source, capabilityName: 'credits.get', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/meta/credits')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer wiza-key')
  })

  it('routes individual_reveal.create as POST /api/individual_reveals', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await wizaConnector.executeMutation!({ source, capabilityName: 'individual_reveal.create', args: {"individual_reveal":{"full_name":"Stephen Hakami","company":"Wiza","domain":"wiza.co"},"enrichment_level":"partial","email_options":{"accept_work":true,"accept_personal":false},"phone_options":{}}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/individual_reveals')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer wiza-key')
    expect(JSON.parse(String(init.body))).toEqual({"individual_reveal":{"full_name":"Stephen Hakami","company":"Wiza","domain":"wiza.co"},"enrichment_level":"partial","email_options":{"accept_work":true,"accept_personal":false},"phone_options":{}})
  })
})
