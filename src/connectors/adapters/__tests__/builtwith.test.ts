import { afterEach, describe, expect, it, vi } from 'vitest'
import { builtwithConnector } from '../builtwith.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_builtwith',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'builtwith',
  label: 'BuiltWith',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'builtwith-key' },
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

describe('builtwith adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(builtwithConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and market-intelligence classification', () => {
    expect(builtwithConnector.manifest.kind).toBe('builtwith')
    expect(builtwithConnector.manifest.displayName).toBe('BuiltWith')
    expect(builtwithConnector.manifest.category).toBe('market-intelligence')
    expect(builtwithConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = builtwithConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['company.to_url', 'domain.free', 'domain.lookup', 'domain.relationships'])
    const reads = builtwithConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = builtwithConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['company.to_url', 'domain.free', 'domain.lookup', 'domain.relationships'])
    expect(mutations).toEqual([])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof builtwithConnector.executeRead).toBe('function')
    expect(typeof builtwithConnector.executeMutation).toBe('function')
  })

  it('routes domain.lookup as GET /v22/api.json', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await builtwithConnector.executeRead!({ source, capabilityName: 'domain.lookup', args: {"lookup":"stripe.com"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v22/api.json')
    expect(init.method).toBe('GET')
    expect(url.searchParams.get('KEY')).toBe('builtwith-key')
    expect(url.searchParams.get('LOOKUP')).toBe('stripe.com')
  })

  it('throws CredentialsExpired when BuiltWith rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      builtwithConnector.executeRead!({ source, capabilityName: 'domain.lookup', args: {"lookup":"stripe.com"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      builtwithConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
