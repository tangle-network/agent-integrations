import { afterEach, describe, expect, it, vi } from 'vitest'
import { serperConnector } from '../serper.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_serper',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'serper',
  label: 'Serper',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'serper-key' },
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

describe('serper adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(serperConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and market-intelligence classification', () => {
    expect(serperConnector.manifest.kind).toBe('serper')
    expect(serperConnector.manifest.displayName).toBe('Serper')
    expect(serperConnector.manifest.category).toBe('market-intelligence')
    expect(serperConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = serperConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['search.images', 'search.news', 'search.places', 'search.scholar', 'search.web'])
    const reads = serperConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = serperConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['search.images', 'search.news', 'search.places', 'search.scholar', 'search.web'])
    expect(mutations).toEqual([])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof serperConnector.executeRead).toBe('function')
    expect(typeof serperConnector.executeMutation).toBe('function')
  })

  it('routes search.web as POST /search', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await serperConnector.executeRead!({ source, capabilityName: 'search.web', args: {"q":"stripe pricing","gl":"us","hl":"en","num":1,"page":1}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/search')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('serper-key')
    expect(JSON.parse(String(init.body))).toEqual({"q":"stripe pricing","gl":"us","hl":"en","num":1,"page":1})
  })

  it('throws CredentialsExpired when Serper rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      serperConnector.executeRead!({ source, capabilityName: 'search.web', args: {"q":"stripe pricing","gl":"us","hl":"en","num":1,"page":1}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      serperConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
