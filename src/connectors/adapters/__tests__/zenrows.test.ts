import { afterEach, describe, expect, it, vi } from 'vitest'
import { zenrowsConnector } from '../zenrows.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_zenrows',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'zenrows',
  label: 'ZenRows',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'zenrows-key' },
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

describe('zenrows adapter', () => {
  it('routes page.scrape as GET /v1/', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await zenrowsConnector.executeRead!({ source, capabilityName: 'page.scrape', args: {"url":"https://example.com","js_render":true}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/')
    expect(init.method).toBe('GET')
    expect(url.searchParams.get('apikey')).toBe('zenrows-key')
    expect(url.searchParams.get('url')).toBe('https://example.com')
    expect(url.searchParams.get('js_render')).toBe('true')
  })

  it('returns the raw payload (not a thrown SyntaxError) when the response is not JSON', async () => {
    const html = '<!DOCTYPE html><html><body>scraped</body></html>'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })))
    const result = await zenrowsConnector.executeRead!({ source, capabilityName: 'page.scrape', args: { url: 'https://example.com' }, idempotencyKey: 'raw_1' })
    // Scrapers return HTML/markdown/PDF; a successful 200 must surface the body
    // under `{ raw }` rather than blowing up on JSON.parse.
    expect(result.data).toEqual({ raw: html })
  })

  it('throws CredentialsExpired when ZenRows rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      zenrowsConnector.executeRead!({ source, capabilityName: 'page.scrape', args: {"url":"https://example.com","js_render":true}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      zenrowsConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
