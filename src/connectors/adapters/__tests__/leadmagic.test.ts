import { afterEach, describe, expect, it, vi } from 'vitest'
import { leadmagicConnector } from '../leadmagic.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_leadmagic',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'leadmagic',
  label: 'LeadMagic',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'leadmagic-key' },
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

describe('leadmagic adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(leadmagicConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and sales-intelligence classification', () => {
    expect(leadmagicConnector.manifest.kind).toBe('leadmagic')
    expect(leadmagicConnector.manifest.displayName).toBe('LeadMagic')
    expect(leadmagicConnector.manifest.category).toBe('sales-intelligence')
    expect(leadmagicConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = leadmagicConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['company.search', 'credits.get', 'email.find', 'email.validate', 'mobile.find', 'profile.search'])
    const reads = leadmagicConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = leadmagicConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['credits.get', 'profile.search'])
    expect(mutations).toEqual(['company.search', 'email.find', 'email.validate', 'mobile.find'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof leadmagicConnector.executeRead).toBe('function')
    expect(typeof leadmagicConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of leadmagicConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes credits.get as GET /v1/credits', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await leadmagicConnector.executeRead!({ source, capabilityName: 'credits.get', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/credits')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('leadmagic-key')
  })

  it('throws CredentialsExpired when LeadMagic rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      leadmagicConnector.executeRead!({ source, capabilityName: 'credits.get', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      leadmagicConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
