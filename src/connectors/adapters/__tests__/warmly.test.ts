import { afterEach, describe, expect, it, vi } from 'vitest'
import { warmlyConnector } from '../warmly.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_warmly',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'warmly',
  label: 'Warmly',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'warmly-key' },
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

describe('warmly adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(warmlyConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and sales-intelligence classification', () => {
    expect(warmlyConnector.manifest.kind).toBe('warmly')
    expect(warmlyConnector.manifest.displayName).toBe('Warmly')
    expect(warmlyConnector.manifest.category).toBe('sales-intelligence')
    expect(warmlyConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = warmlyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['accounts.list', 'tools.list', 'visitors.list'])
    const reads = warmlyConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = warmlyConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['tools.list'])
    expect(mutations).toEqual(['accounts.list', 'visitors.list'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof warmlyConnector.executeRead).toBe('function')
    expect(typeof warmlyConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of warmlyConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes tools.list as GET /api/agent-tools/tools', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await warmlyConnector.executeRead!({ source, capabilityName: 'tools.list', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/agent-tools/tools')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer warmly-key')
  })

  it('routes visitors.list as POST /api/agent-tools/execute', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await warmlyConnector.executeMutation!({ source, capabilityName: 'visitors.list', args: {"organizationId":"org_123","timeWindow":"past_day","take":25,"offset":1,"searchTerm":"x"}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/agent-tools/execute')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer warmly-key')
    expect(JSON.parse(String(init.body))).toEqual({"toolName":"list_warm_visitors","organizationId":"org_123","input":{"timeWindow":"past_day","take":25,"offset":1,"searchTerm":"x"}})
  })

  it('throws CredentialsExpired when Warmly rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      warmlyConnector.executeRead!({ source, capabilityName: 'tools.list', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      warmlyConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
