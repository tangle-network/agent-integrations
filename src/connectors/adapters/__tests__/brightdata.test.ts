import { afterEach, describe, expect, it, vi } from 'vitest'
import { brightdataConnector } from '../brightdata.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_brightdata',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'brightdata',
  label: 'Bright Data',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'brightdata-key' },
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

describe('brightdata adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(brightdataConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and other classification', () => {
    expect(brightdataConnector.manifest.kind).toBe('brightdata')
    expect(brightdataConnector.manifest.displayName).toBe('Bright Data')
    expect(brightdataConnector.manifest.category).toBe('other')
    expect(brightdataConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = brightdataConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['scraper.progress', 'scraper.snapshot', 'scraper.trigger', 'unlocker.request'])
    const reads = brightdataConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = brightdataConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['scraper.progress', 'scraper.snapshot', 'unlocker.request'])
    expect(mutations).toEqual(['scraper.trigger'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof brightdataConnector.executeRead).toBe('function')
    expect(typeof brightdataConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of brightdataConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes scraper.progress as GET /datasets/v3/progress/s_m4x7enmven8djfqak', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await brightdataConnector.executeRead!({ source, capabilityName: 'scraper.progress', args: {"snapshot_id":"s_m4x7enmven8djfqak"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/datasets/v3/progress/s_m4x7enmven8djfqak')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer brightdata-key')
  })

  it('routes scraper.trigger as POST /datasets/v3/trigger', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await brightdataConnector.executeMutation!({ source, capabilityName: 'scraper.trigger', args: {"dataset_id":"gd_l1viktl72bvl7bjuj0","format":"json","inputs":[{"url":"https://www.airbnb.com/rooms/50122531"}]}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/datasets/v3/trigger')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer brightdata-key')
    expect(url.searchParams.get('dataset_id')).toBe('gd_l1viktl72bvl7bjuj0')
    expect(url.searchParams.get('format')).toBe('json')
    expect(JSON.parse(String(init.body))).toEqual([{"url":"https://www.airbnb.com/rooms/50122531"}])
  })

  it('throws CredentialsExpired when Bright Data rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      brightdataConnector.executeRead!({ source, capabilityName: 'scraper.progress', args: {"snapshot_id":"s_m4x7enmven8djfqak"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      brightdataConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
