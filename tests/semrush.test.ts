import { afterEach, describe, expect, it, vi } from 'vitest'
import { semrushConnector } from '../src/connectors/adapters/semrush.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_semrush_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'semrush',
    label: 'Drew Semrush',
    consistencyModel: 'cache',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'semrush-test-key' },
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

const EXPECTED = [
  'backlinks.overview',
  'backlinks.summary',
  'backlinks.links',
  'backlinks.ref_domains',
  'backlinks.ref_ips',
  'backlinks.anchors',
  'backlinks.pages',
  'backlinks.score_profile',
  'backlinks.comparison',
  'keyword.metrics',
]

describe('semrush adapter manifest', () => {
  it('classifies itself as market-intelligence with api-key auth', () => {
    expect(semrushConnector.manifest.kind).toBe('semrush')
    expect(semrushConnector.manifest.category).toBe('market-intelligence')
    expect(semrushConnector.manifest.defaultConsistencyModel).toBe('cache')
    expect(semrushConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the v4 backlinks + keyword read set and no mutations', () => {
    const names = semrushConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([...EXPECTED].sort())
    const mutations = semrushConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations).toEqual([])
  })
})

describe('semrush executeRead', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the v4 backlinks overview with the Apikey Authorization header and url/scope query', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      return jsonResponse({ data: { backlinks_num: 100, domains_num: 10 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await semrushConnector.executeRead!({
      source: source(),
      capabilityName: 'backlinks.overview',
      args: { url: 'semrush.com', scope: 'ROOT_DOMAIN' },
      idempotencyKey: 'k',
    })

    expect(capturedMethod).toBe('GET')
    const url = new URL(capturedUrl)
    expect(url.origin).toBe('https://api.semrush.com')
    expect(url.pathname).toBe('/apis/v4/backlinks/v1/overview')
    expect(url.searchParams.get('url')).toBe('semrush.com')
    expect(url.searchParams.get('scope')).toBe('ROOT_DOMAIN')
    // The key rides in the Authorization header with the literal "Apikey " prefix.
    expect(capturedHeaders['Authorization']).toBe('Apikey semrush-test-key')
    expect(result.data).toMatchObject({ data: { backlinks_num: 100 } })
  })

  it('omits unset optional query params and builds the keyword.metrics request', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ data: { volume: 5400 } })
    }))

    await semrushConnector.executeRead!({
      source: source(),
      capabilityName: 'keyword.metrics',
      args: { keyword: 'crm software', country: 'us' },
      idempotencyKey: 'k',
    })

    const url = new URL(capturedUrl)
    expect(url.pathname).toBe('/apis/v4/keywords/v1/metrics')
    expect(url.searchParams.get('keyword')).toBe('crm software')
    expect(url.searchParams.get('country')).toBe('us')
    // `month` was not supplied, so the runtime must not emit an empty param.
    expect(url.searchParams.has('month')).toBe(false)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } })),
    )
    await expect(
      semrushConnector.executeRead!({
        source: source(),
        capabilityName: 'backlinks.overview',
        args: { url: 'semrush.com', scope: 'ROOT_DOMAIN' },
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
      semrushConnector.executeRead!({
        source: source(),
        capabilityName: 'backlinks.overview',
        args: { url: 'semrush.com', scope: 'ROOT_DOMAIN' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
