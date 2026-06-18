import { afterEach, describe, expect, it, vi } from 'vitest'
import { getresponseConnector } from '../getresponse.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_getresponse',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'getresponse',
  label: 'GetResponse',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'getresponse-key' },
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

describe('getresponse adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(getresponseConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and crm classification', () => {
    expect(getresponseConnector.manifest.kind).toBe('getresponse')
    expect(getresponseConnector.manifest.displayName).toBe('GetResponse')
    expect(getresponseConnector.manifest.category).toBe('crm')
    expect(getresponseConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = getresponseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['campaigns.list', 'contacts.create', 'contacts.list', 'newsletters.create'])
    const reads = getresponseConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = getresponseConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['campaigns.list', 'contacts.list'])
    expect(mutations).toEqual(['contacts.create', 'newsletters.create'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof getresponseConnector.executeRead).toBe('function')
    expect(typeof getresponseConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of getresponseConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes contacts.list as GET /v3/contacts', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await getresponseConnector.executeRead!({ source, capabilityName: 'contacts.list', args: {"perPage":50}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v3/contacts')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-Auth-Token']).toBe('api-key getresponse-key')
    expect(url.searchParams.get('perPage')).toBe('50')
  })

  it('routes contacts.create as POST /v3/contacts', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await getresponseConnector.executeMutation!({ source, capabilityName: 'contacts.create', args: {"email":"test@example.com","campaign_id":"p86zQ","name":"x","dayOfCycle":1}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v3/contacts')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Auth-Token']).toBe('api-key getresponse-key')
    expect(JSON.parse(String(init.body))).toEqual({"email":"test@example.com","name":"x","dayOfCycle":1,"campaign":{"campaignId":"p86zQ"}})
  })

  it('throws CredentialsExpired when GetResponse rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      getresponseConnector.executeRead!({ source, capabilityName: 'contacts.list', args: {"perPage":50}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      getresponseConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
