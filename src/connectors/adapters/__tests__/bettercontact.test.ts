import { afterEach, describe, expect, it, vi } from 'vitest'
import { bettercontactConnector } from '../bettercontact.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_bettercontact',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'bettercontact',
  label: 'BetterContact',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'bettercontact-key' },
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

describe('bettercontact adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(bettercontactConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and crm classification', () => {
    expect(bettercontactConnector.manifest.kind).toBe('bettercontact')
    expect(bettercontactConnector.manifest.displayName).toBe('BetterContact')
    expect(bettercontactConnector.manifest.category).toBe('crm')
    expect(bettercontactConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = bettercontactConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['enrichment.create', 'enrichment.get'])
    const reads = bettercontactConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = bettercontactConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['enrichment.get'])
    expect(mutations).toEqual(['enrichment.create'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof bettercontactConnector.executeRead).toBe('function')
    expect(typeof bettercontactConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of bettercontactConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes enrichment.get as GET /api/v2/async/123456', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await bettercontactConnector.executeRead!({ source, capabilityName: 'enrichment.get', args: {"request_id":"123456"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/async/123456')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('bettercontact-key')
  })

  it('throws CredentialsExpired when BetterContact rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      bettercontactConnector.executeRead!({ source, capabilityName: 'enrichment.get', args: {"request_id":"123456"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      bettercontactConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
