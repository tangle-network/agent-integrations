import { afterEach, describe, expect, it, vi } from 'vitest'
import { hightouchConnector } from '../hightouch.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_hightouch',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'hightouch',
  label: 'Hightouch',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'hightouch-key' },
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

describe('hightouch adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(hightouchConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and database classification', () => {
    expect(hightouchConnector.manifest.kind).toBe('hightouch')
    expect(hightouchConnector.manifest.displayName).toBe('Hightouch')
    expect(hightouchConnector.manifest.category).toBe('database')
    expect(hightouchConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = hightouchConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['destinations.list', 'sources.list', 'syncs.get', 'syncs.list', 'syncs.list_runs', 'syncs.trigger'])
    const reads = hightouchConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = hightouchConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['destinations.list', 'sources.list', 'syncs.get', 'syncs.list', 'syncs.list_runs'])
    expect(mutations).toEqual(['syncs.trigger'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof hightouchConnector.executeRead).toBe('function')
    expect(typeof hightouchConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of hightouchConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes syncs.list as GET /api/v1/syncs', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await hightouchConnector.executeRead!({ source, capabilityName: 'syncs.list', args: {"limit":25}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v1/syncs')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer hightouch-key')
    expect(url.searchParams.get('limit')).toBe('25')
  })

  it('routes syncs.trigger as POST /api/v1/syncs/123/trigger', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await hightouchConnector.executeMutation!({ source, capabilityName: 'syncs.trigger', args: {"syncId":"123","fullResync":false,"resetCDC":true}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v1/syncs/123/trigger')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer hightouch-key')
    expect(JSON.parse(String(init.body))).toEqual({"fullResync":false,"resetCDC":true})
  })

  it('throws CredentialsExpired when Hightouch rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      hightouchConnector.executeRead!({ source, capabilityName: 'syncs.list', args: {"limit":25}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      hightouchConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
