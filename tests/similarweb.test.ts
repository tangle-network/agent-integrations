import { afterEach, describe, expect, it, vi } from 'vitest'
import { similarwebConnector } from '../src/connectors/adapters/similarweb.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_similarweb_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'similarweb',
    label: 'Drew Similarweb',
    consistencyModel: 'cache',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'similarweb-test-key',
    },
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

const EXPECTED_CAPABILITIES = [
  'rank.global',
  'rank.country',
  'rank.category',
  'total-traffic.visits',
  'total-traffic.pages-per-visit',
  'total-traffic.average-visit-duration',
  'total-traffic.bounce-rate',
  'desktop-traffic.visits',
  'traffic-sources.overview-share',
  'traffic-sources.referrals',
  'traffic-sources.social',
  'geo.traffic-by-country',
  'audience.similar-sites',
  'audience.also-visited',
  'keywords.website-keywords',
  'lead-enrichment',
]

describe('similarweb adapter manifest', () => {
  it('classifies itself as market-intelligence with cache consistency', () => {
    expect(similarwebConnector.manifest.kind).toBe('similarweb')
    expect(similarwebConnector.manifest.category).toBe('market-intelligence')
    expect(similarwebConnector.manifest.defaultConsistencyModel).toBe('cache')
  })

  it('uses api-key auth', () => {
    expect(similarwebConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the full read-only intelligence capability set and no mutations', () => {
    const names = similarwebConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([...EXPECTED_CAPABILITIES].sort())

    const reads = similarwebConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = similarwebConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual([...EXPECTED_CAPABILITIES].sort())
    expect(mutations).toEqual([])
  })
})

describe('similarweb executeRead', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs total visits with the api_key in the query string (not a header) and the documented path/params', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      return jsonResponse({ meta: { request: {} }, visits: [{ date: '2026-01-01', visits: 12345 }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await similarwebConnector.executeRead!({
      source: source(),
      capabilityName: 'total-traffic.visits',
      args: {
        domain: 'cnn.com',
        country: 'us',
        granularity: 'monthly',
        start_date: '2026-01',
        end_date: '2026-03',
      },
      idempotencyKey: 'k',
    })

    expect(capturedMethod).toBe('GET')
    const url = new URL(capturedUrl)
    expect(url.origin).toBe('https://api.similarweb.com')
    expect(url.pathname).toBe('/v1/website/cnn.com/total-traffic-and-engagement/visits')
    expect(url.searchParams.get('api_key')).toBe('similarweb-test-key')
    expect(url.searchParams.get('country')).toBe('us')
    expect(url.searchParams.get('granularity')).toBe('monthly')
    expect(url.searchParams.get('start_date')).toBe('2026-01')
    expect(url.searchParams.get('end_date')).toBe('2026-03')
    // The key rides in the query string — never the Authorization header.
    expect(capturedHeaders['authorization']).toBeUndefined()

    expect(result.data).toMatchObject({ visits: [{ visits: 12345 }] })
    expect(typeof result.fetchedAt).toBe('number')
  })

  it('maps domain to the URL query parameter for the keyword endpoint (no {domain} path segment)', async () => {
    let capturedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ keywords: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await similarwebConnector.executeRead!({
      source: source(),
      capabilityName: 'keywords.website-keywords',
      args: { domain: 'cnn.com', country: 'us', traffic_source: 'Organic' },
      idempotencyKey: 'k',
    })

    const url = new URL(capturedUrl)
    expect(url.pathname).toBe('/v4/website-analysis/keywords')
    expect(url.searchParams.get('URL')).toBe('cnn.com')
    expect(url.searchParams.get('country')).toBe('us')
    expect(url.searchParams.get('traffic_source')).toBe('Organic')
    expect(url.searchParams.get('api_key')).toBe('similarweb-test-key')
  })

  it('rejects when the required domain path arg is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      similarwebConnector.executeRead!({
        source: source(),
        capabilityName: 'rank.global',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/domain/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } })),
    )
    await expect(
      similarwebConnector.executeRead!({
        source: source(),
        capabilityName: 'rank.global',
        args: { domain: 'cnn.com' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })),
    )
    await expect(
      similarwebConnector.executeRead!({
        source: source(),
        capabilityName: 'rank.global',
        args: { domain: 'cnn.com' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
