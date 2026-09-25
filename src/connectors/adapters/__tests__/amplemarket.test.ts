import { afterEach, describe, expect, it, vi } from 'vitest'
import { amplemarketConnector } from '../amplemarket.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_amplemarket',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'amplemarket',
  label: 'Amplemarket',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'amplemarket-key' },
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

describe('amplemarket adapter', () => {
  it('routes companies.find as GET /companies/find', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await amplemarketConnector.executeRead!({ source, capabilityName: 'companies.find', args: {"domain":"stripe.com"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/companies/find')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer amplemarket-key')
    expect(url.searchParams.get('domain')).toBe('stripe.com')
  })

  it('throws CredentialsExpired when Amplemarket rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      amplemarketConnector.executeRead!({ source, capabilityName: 'companies.find', args: {"domain":"stripe.com"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      amplemarketConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
