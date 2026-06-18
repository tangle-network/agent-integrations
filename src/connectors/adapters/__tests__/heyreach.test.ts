import { afterEach, describe, expect, it, vi } from 'vitest'
import { heyreachConnector } from '../heyreach.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_heyreach',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'heyreach',
  label: 'HeyReach',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'heyreach-key' },
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

describe('heyreach adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(heyreachConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and crm classification', () => {
    expect(heyreachConnector.manifest.kind).toBe('heyreach')
    expect(heyreachConnector.manifest.displayName).toBe('HeyReach')
    expect(heyreachConnector.manifest.category).toBe('crm')
    expect(heyreachConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = heyreachConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['campaign.add_leads', 'campaign.list', 'inbox.get_conversations', 'lead.get', 'list.list'])
    const reads = heyreachConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = heyreachConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['campaign.list', 'inbox.get_conversations', 'lead.get', 'list.list'])
    expect(mutations).toEqual(['campaign.add_leads'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof heyreachConnector.executeRead).toBe('function')
    expect(typeof heyreachConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of heyreachConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes campaign.list as POST /api/public/campaign/GetAll', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await heyreachConnector.executeRead!({ source, capabilityName: 'campaign.list', args: {"offset":0,"limit":10}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/public/campaign/GetAll')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('heyreach-key')
    expect(JSON.parse(String(init.body))).toEqual({"offset":0,"limit":10})
  })

  it('throws CredentialsExpired when HeyReach rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      heyreachConnector.executeRead!({ source, capabilityName: 'campaign.list', args: {"offset":0,"limit":10}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      heyreachConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
