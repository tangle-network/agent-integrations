import { afterEach, describe, expect, it, vi } from 'vitest'
import { lagrowthmachineConnector } from '../lagrowthmachine.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_lagrowthmachine',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'lagrowthmachine',
  label: 'LaGrowthMachine',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'lagrowthmachine-key' },
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

describe('lagrowthmachine adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(lagrowthmachineConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and crm classification', () => {
    expect(lagrowthmachineConnector.manifest.kind).toBe('lagrowthmachine')
    expect(lagrowthmachineConnector.manifest.displayName).toBe('LaGrowthMachine')
    expect(lagrowthmachineConnector.manifest.category).toBe('crm')
    expect(lagrowthmachineConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = lagrowthmachineConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['audiences.list', 'campaign.get_stats', 'campaigns.list', 'lead.create_or_update'])
    const reads = lagrowthmachineConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = lagrowthmachineConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['audiences.list', 'campaign.get_stats', 'campaigns.list'])
    expect(mutations).toEqual(['lead.create_or_update'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof lagrowthmachineConnector.executeRead).toBe('function')
    expect(typeof lagrowthmachineConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of lagrowthmachineConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes campaigns.list as GET /flow/campaigns', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await lagrowthmachineConnector.executeRead!({ source, capabilityName: 'campaigns.list', args: {"skip":0,"limit":25}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/flow/campaigns')
    expect(init.method).toBe('GET')
    expect(url.searchParams.get('apikey')).toBe('lagrowthmachine-key')
    expect(url.searchParams.get('skip')).toBe('0')
    expect(url.searchParams.get('limit')).toBe('25')
  })

  it('throws CredentialsExpired when LaGrowthMachine rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      lagrowthmachineConnector.executeRead!({ source, capabilityName: 'campaigns.list', args: {"skip":0,"limit":25}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      lagrowthmachineConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
