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
  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = googleSearchConsoleConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
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
