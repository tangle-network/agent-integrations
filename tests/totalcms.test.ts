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
  it('classifies itself as the crm category and exposes the totalcms kind', () => {
    expect(totalcmsConnector.manifest.kind).toBe('totalcms')
    expect(totalcmsConnector.manifest.category).toBe('crm')
    expect(totalcmsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = totalcmsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set plus delete + media.list', () => {
    const names = totalcmsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'posts.get_blog_post',
        'content.get_content',
        'posts.save_blog_post',
        'content.save_content',
        'media.save_image',
        'media.save_blog_image',
        'media.save_video',
        'media.save_gallery',
        'media.save_blog_gallery',
        'data.save_file',
        'data.save_text',
        'data.save_toggle',
        'data.save_date',
        'depot.save_depot',
        'posts.delete',
        'content.delete',
        'media.delete',
        'media.list',
      ].sort(),
    )
    const reads = totalcmsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = totalcmsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['content.get_content', 'media.list', 'posts.get_blog_post'].sort())
    expect(mutations).toEqual(
      [
        'content.save_content',
        'data.save_date',
        'data.save_file',
        'data.save_text',
        'data.save_toggle',
        'depot.save_depot',
        'media.save_blog_gallery',
        'media.save_blog_image',
        'media.save_gallery',
        'media.save_image',
        'media.save_video',
        'posts.save_blog_post',
        'posts.delete',
        'content.delete',
        'media.delete',
      ].sort(),
    )
  })

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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      totalcmsConnector.executeMutation!({
        source: source(),
        capabilityName: 'posts.delete',
        args: { slug: 'hello-world' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
