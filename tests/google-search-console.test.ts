import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleSearchConsoleConnector } from '../src/connectors/adapters/google-search-console.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_gsc_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'google-search-console',
    label: 'gsc test',
    consistencyModel: 'cache',
    scopes: ['https://www.googleapis.com/auth/webmasters'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'ya29_abc' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('google-search-console adapter manifest', () => {
  it('exposes the google-search-console kind and maps the activepieces "workflow" piece category onto an allowed connector category', () => {
    expect(googleSearchConsoleConnector.manifest.kind).toBe('google-search-console')
    // Catalog category is "workflow"; the connector category enum doesn't have
    // "workflow", and Search Console isn't a calendar/spreadsheet/CRM/etc., so
    // we land it in "other" — the explicit fallback the type permits.
    expect(googleSearchConsoleConnector.manifest.category).toBe('other')
    expect(googleSearchConsoleConnector.manifest.defaultConsistencyModel).toBe('cache')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = googleSearchConsoleConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (URL inspection, search analytics, sitemaps, sites)', () => {
    const names = googleSearchConsoleConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'urlInspection.index',
        'searchAnalytics.query',
        'sites.list',
        'sites.add',
        'sites.delete',
        'sitemaps.list',
        'sitemaps.submit',
        'sitemaps.delete',
      ].sort(),
    )
    const reads = googleSearchConsoleConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = googleSearchConsoleConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['urlInspection.index', 'searchAnalytics.query', 'sites.list', 'sitemaps.list'].sort(),
    )
    expect(mutations).toEqual(['sites.add', 'sites.delete', 'sitemaps.submit', 'sitemaps.delete'].sort())
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    for (const cap of googleSearchConsoleConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('google-search-console sitemaps.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await googleSearchConsoleConnector.executeMutation!({
      source: source(),
      capabilityName: 'sitemaps.delete',
      args: { siteUrl: 'https://example.com/', feedpath: 'https://example.com/sitemap.xml' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/webmasters/v3/sites/')
    expect(String(requestUrl)).toContain('/sitemaps/')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      googleSearchConsoleConnector.executeMutation!({
        source: source(),
        capabilityName: 'sitemaps.delete',
        args: { siteUrl: 'https://example.com/', feedpath: 'https://example.com/sitemap.xml' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
