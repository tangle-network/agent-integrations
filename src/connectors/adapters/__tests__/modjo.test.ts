import { afterEach, describe, expect, it, vi } from 'vitest'
import { modjoConnector } from '../modjo.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_modjo',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'modjo',
  label: 'Modjo',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'modjo-key' },
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

describe('modjo adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(modjoConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and doc classification', () => {
    expect(modjoConnector.manifest.kind).toBe('modjo')
    expect(modjoConnector.manifest.displayName).toBe('Modjo')
    expect(modjoConnector.manifest.category).toBe('doc')
    expect(modjoConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = modjoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['calls.export', 'teams.list', 'users.list'])
    const reads = modjoConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = modjoConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['calls.export', 'teams.list', 'users.list'])
    expect(mutations).toEqual([])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof modjoConnector.executeRead).toBe('function')
    expect(typeof modjoConnector.executeMutation).toBe('function')
  })

  it('routes calls.export as POST /v1/calls/exports', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await modjoConnector.executeRead!({ source, capabilityName: 'calls.export', args: {"page":1,"perPage":20,"transcript":true,"aiSummary":true,"contacts":true}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/calls/exports')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('modjo-key')
    expect(JSON.parse(String(init.body))).toEqual({"pagination":{"page":1,"perPage":20},"relations":{"transcript":true,"aiSummary":true,"contacts":true}})
  })

  it('routes users.list as GET /v1/users', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await modjoConnector.executeRead!({ source, capabilityName: 'users.list', args: {"page":1,"perPage":20}, idempotencyKey: 'op_1' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/users')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('modjo-key')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('perPage')).toBe('20')
  })

  it('throws CredentialsExpired when Modjo rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      modjoConnector.executeRead!({ source, capabilityName: 'calls.export', args: {"page":1,"perPage":20,"transcript":true,"aiSummary":true,"contacts":true}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      modjoConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
