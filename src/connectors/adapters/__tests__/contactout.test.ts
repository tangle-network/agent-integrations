import { afterEach, describe, expect, it, vi } from 'vitest'
import { contactoutConnector } from '../contactout.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_contactout',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'contactout',
  label: 'ContactOut',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'contactout-key' },
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

describe('contactout adapter', () => {
  it('routes linkedin.enrich as GET /v1/linkedin/enrich', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await contactoutConnector.executeMutation!({ source, capabilityName: 'linkedin.enrich', args: {"profile":"https://www.linkedin.com/in/williamhgates"}, idempotencyKey: 'op_0' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/linkedin/enrich')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['token']).toBe('contactout-key')
    expect(url.searchParams.get('profile')).toBe('https://www.linkedin.com/in/williamhgates')
  })

  it('routes email.verify as GET /v1/email/verify', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await contactoutConnector.executeMutation!({ source, capabilityName: 'email.verify', args: {"email":"ada@stripe.com"}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/email/verify')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['token']).toBe('contactout-key')
    expect(url.searchParams.get('email')).toBe('ada@stripe.com')
  })
})
