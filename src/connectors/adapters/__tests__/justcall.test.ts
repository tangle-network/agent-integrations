import { afterEach, describe, expect, it, vi } from 'vitest'
import { justcallConnector } from '../justcall.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_justcall',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'justcall',
  label: 'JustCall',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'justcall-key' },
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

describe('justcall adapter', () => {
  it('routes calls.list as GET /v2.1/calls', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await justcallConnector.executeRead!({ source, capabilityName: 'calls.list', args: {"per_page":20}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2.1/calls')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('justcall-key')
    expect(url.searchParams.get('per_page')).toBe('20')
  })

  it('routes sms.send as POST /v2.1/texts/new', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await justcallConnector.executeMutation!({ source, capabilityName: 'sms.send', args: {"justcall_number":"+14155550100","contact_number":"+14155550111","body":"Hello from JustCall","media_url":"x"}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2.1/texts/new')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('justcall-key')
    expect(JSON.parse(String(init.body))).toEqual({"justcall_number":"+14155550100","contact_number":"+14155550111","body":"Hello from JustCall","media_url":"x"})
  })
})
