import { afterEach, describe, expect, it, vi } from 'vitest'
import { postizConnector } from '../src/connectors/adapters/postiz.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_postiz_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'postiz',
    label: 'postiz test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'postiz_secret' },
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

describe('postiz adapter manifest', () => {
  it('classifies itself as the other category and exposes the postiz kind', () => {
    expect(postizConnector.manifest.kind).toBe('postiz')
    expect(postizConnector.manifest.category).toBe('other')
    expect(postizConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = postizConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the read + mutation surface (posts, integrations, analytics, media, slots)', () => {
    const names = postizConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'analytics.platform',
        'analytics.post',
        'integrations.disconnect',
        'integrations.list',
        'media.delete',
        'media.upload',
        'posts.create',
        'posts.delete',
        'posts.list',
        'posts.schedule',
        'posts.update',
        'slots.find',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency + external effect', () => {
    const mutations = postizConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('unreachable')
      expect(m.cas).toBe('native-idempotency')
      expect(m.externalEffect).toBe(true)
    }
  })
})

describe('postiz posts.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues PUT /posts/{postId} with the bearer token', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestHeaders: Headers | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestHeaders = new Headers(init?.headers)
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'post_42', content: 'edited' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postizConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.update',
      args: { postId: 'post_42', content: 'edited' },
      idempotencyKey: 'k-update-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toBe('https://api.postiz.com/api/v1/posts/post_42')
    expect(requestHeaders!.get('authorization')).toBe('Bearer postiz_secret')
    expect(JSON.parse(requestBody!)).toEqual({ postId: 'post_42', content: 'edited' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      postizConnector.executeMutation!({
        source: source(),
        capabilityName: 'posts.update',
        args: { postId: 'post_42' },
        idempotencyKey: 'k-update-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('postiz posts.schedule', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues POST /posts with type=schedule', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'post_99' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postizConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.schedule',
      args: { content: 'hello', type: 'schedule', date: '2026-12-31T12:00:00Z' },
      idempotencyKey: 'k-sched-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toBe('https://api.postiz.com/api/v1/posts')
    const parsed = JSON.parse(requestBody!)
    expect(parsed.type).toBe('schedule')
    expect(parsed.content).toBe('hello')
    expect(parsed.date).toBe('2026-12-31T12:00:00Z')
  })
})

describe('postiz integrations.disconnect', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /integrations/{integrationId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postizConnector.executeMutation!({
      source: source(),
      capabilityName: 'integrations.disconnect',
      args: { integrationId: 'twitter_123' },
      idempotencyKey: 'k-disc-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.postiz.com/api/v1/integrations/twitter_123')
  })

  it('tolerates 204 no-content responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(null, { status: 204 })),
    )
    const result = await postizConnector.executeMutation!({
      source: source(),
      capabilityName: 'integrations.disconnect',
      args: { integrationId: 'twitter_123' },
      idempotencyKey: 'k-disc-2',
    })
    expect(result.status).toBe('committed')
  })
})

describe('postiz media.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /media/{mediaId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postizConnector.executeMutation!({
      source: source(),
      capabilityName: 'media.delete',
      args: { mediaId: 'media_abc' },
      idempotencyKey: 'k-mdel-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.postiz.com/api/v1/media/media_abc')
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      postizConnector.executeMutation!({
        source: source(),
        capabilityName: 'media.delete',
        args: { mediaId: 'media_abc' },
        idempotencyKey: 'k-mdel-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
