import { afterEach, describe, expect, it, vi } from 'vitest'
import { saleshandyConnector } from '../saleshandy.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_saleshandy',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'saleshandy',
  label: 'Saleshandy',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'saleshandy-key' },
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

describe('saleshandy adapter', () => {
  it('routes sequences.list as GET /v1/sequences', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await saleshandyConnector.executeRead!({ source, capabilityName: 'sequences.list', args: {"page":1,"pageSize":10}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/sequences')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('saleshandy-key')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('pageSize')).toBe('10')
  })

  it('throws CredentialsExpired when Saleshandy rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      saleshandyConnector.executeRead!({ source, capabilityName: 'sequences.list', args: {"page":1,"pageSize":10}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      saleshandyConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
