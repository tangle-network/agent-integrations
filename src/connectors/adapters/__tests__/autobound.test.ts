import { afterEach, describe, expect, it, vi } from 'vitest'
import { autoboundConnector } from '../autobound.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_autobound',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'autobound',
  label: 'Autobound',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'autobound-key' },
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

describe('autobound adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(autoboundConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and sales-intelligence classification', () => {
    expect(autoboundConnector.manifest.kind).toBe('autobound')
    expect(autoboundConnector.manifest.displayName).toBe('Autobound')
    expect(autoboundConnector.manifest.category).toBe('sales-intelligence')
    expect(autoboundConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = autoboundConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['account.get', 'company.enrich', 'company.search', 'contact.enrich', 'contact.search'])
    const reads = autoboundConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = autoboundConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['account.get', 'company.search', 'contact.search'])
    expect(mutations).toEqual(['company.enrich', 'contact.enrich'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof autoboundConnector.executeRead).toBe('function')
    expect(typeof autoboundConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of autoboundConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes account.get as GET /v1/account', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await autoboundConnector.executeRead!({ source, capabilityName: 'account.get', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/account')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('autobound-key')
  })

  it('throws CredentialsExpired when Autobound rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      autoboundConnector.executeRead!({ source, capabilityName: 'account.get', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      autoboundConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
