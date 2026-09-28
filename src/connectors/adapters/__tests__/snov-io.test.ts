import { afterEach, describe, expect, it, vi } from 'vitest'
import { snovIoConnector } from '../snov-io.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_snov_io',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'snov-io',
  label: 'Snov.io',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'snov-io-key' },
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

describe('snov-io adapter', () => {
  it('routes domain_emails_count.get as POST /v1/get-domain-emails-count', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await snovIoConnector.executeRead!({ source, capabilityName: 'domain_emails_count.get', args: {"domain":"stripe.com"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/get-domain-emails-count')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer snov-io-key')
    expect(JSON.parse(String(init.body))).toEqual({"domain":"stripe.com"})
  })

  it('routes email_verification.start as POST /v2/email-verification/start', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await snovIoConnector.executeMutation!({ source, capabilityName: 'email_verification.start', args: {"emails":["ada@stripe.com"]}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/email-verification/start')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer snov-io-key')
    expect(JSON.parse(String(init.body))).toEqual({"emails":["ada@stripe.com"]})
  })
})
