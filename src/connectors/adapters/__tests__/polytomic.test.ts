import { afterEach, describe, expect, it, vi } from 'vitest'
import { polytomicConnector } from '../polytomic.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_polytomic',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'polytomic',
  label: 'Polytomic',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'polytomic-key' },
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

describe('polytomic adapter', () => {
  it('routes syncs.list as GET /api/syncs', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await polytomicConnector.executeRead!({ source, capabilityName: 'syncs.list', args: {"limit":25}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/syncs')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer polytomic-key')
    expect(url.searchParams.get('limit')).toBe('25')
  })

  it('throws CredentialsExpired when Polytomic rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      polytomicConnector.executeRead!({ source, capabilityName: 'syncs.list', args: {"limit":25}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      polytomicConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
