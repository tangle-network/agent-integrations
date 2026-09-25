import { afterEach, describe, expect, it, vi } from 'vitest'
import { totalcmsConnector } from '../src/connectors/adapters/totalcms.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_totalcms_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'totalcms',
    label: 'TotalCMS test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'totalcms_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('totalcms adapter manifest', () => {
  it('marks every delete mutation as native-idempotency + external-effect', () => {
    const byName = new Map(totalcmsConnector.manifest.capabilities.map((c) => [c.name, c]))
    for (const name of ['posts.delete', 'content.delete', 'media.delete']) {
      const cap = byName.get(name)
      if (!cap || cap.class !== 'mutation') throw new Error(`missing mutation: ${name}`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('totalcms posts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /posts/{slug}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true }, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await totalcmsConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.delete',
      args: { slug: 'hello-world' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/posts/hello-world')
  })
})

describe('totalcms media.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues GET /media with query filter', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ items: [{ id: 'm1' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await totalcmsConnector.executeRead!({
      source: source(),
      capabilityName: 'media.list',
      args: { type: 'images', limit: 25 },
      idempotencyKey: 'k-media-list-1',
    })
    expect(result.data).toEqual({ items: [{ id: 'm1' }] })
    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/v1/media')
    expect(String(requestUrl)).toContain('type=images')
    expect(String(requestUrl)).toContain('limit=25')
  })
})

describe('totalcms content.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /content/{permalink}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ ok: true })
      }),
    )
    const result = await totalcmsConnector.executeMutation!({
      source: source(),
      capabilityName: 'content.delete',
      args: { permalink: 'footer' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/content/footer')
  })
})

describe('totalcms media.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /media/{id}', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return jsonResponse({ ok: true })
      }),
    )
    const result = await totalcmsConnector.executeMutation!({
      source: source(),
      capabilityName: 'media.delete',
      args: { id: 'asset_123' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/v1/media/asset_123')
  })
})
