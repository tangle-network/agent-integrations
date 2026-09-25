import { afterEach, describe, expect, it, vi } from 'vitest'
import { leadfeederConnector } from '../leadfeeder.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_leadfeeder',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'leadfeeder',
  label: 'Leadfeeder',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'leadfeeder-key' },
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

describe('leadfeeder adapter', () => {
  it('routes ip.enrich as GET /companies', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await leadfeederConnector.executeRead!({ source, capabilityName: 'ip.enrich', args: {"ip":"185.70.216.139"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/companies')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('leadfeeder-key')
    expect(url.searchParams.get('ip')).toBe('185.70.216.139')
  })

  it('throws CredentialsExpired when Leadfeeder rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      leadfeederConnector.executeRead!({ source, capabilityName: 'ip.enrich', args: {"ip":"185.70.216.139"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      leadfeederConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
