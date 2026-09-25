import { afterEach, describe, expect, it, vi } from 'vitest'
import { brightdataConnector } from '../brightdata.js'
import { type ResolvedDataSource } from '../../types.js'

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
})
