import { afterEach, describe, expect, it, vi } from 'vitest'
import { appfollowConnector } from '../src/connectors/adapters/appfollow.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_appfollow_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'appfollow',
    label: 'appfollow test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'appfollow_secret' },
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

describe('appfollow adapter manifest', () => {
  it('classifies itself as the database category and exposes the appfollow kind', () => {
    expect(appfollowConnector.manifest.kind).toBe('appfollow')
    expect(appfollowConnector.manifest.category).toBe('database')
    expect(appfollowConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = appfollowConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers reviews, reply lifecycle, and tag assignment', () => {
    const names = appfollowConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'add.user',
        'reply.delete',
        'reply.to.review',
        'reply.update',
        'reviews.list',
        'tags.assign',
        'tags.list',
      ].sort(),
    )

    const mutations = appfollowConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['add.user', 'reply.delete', 'reply.to.review', 'reply.update', 'tags.assign'].sort(),
    )

    const reads = appfollowConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['reviews.list', 'tags.list'].sort())
  })

  it('marks every mutation as native-idempotency external-effect', () => {
    for (const cap of appfollowConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('appfollow reply.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /reviews/reply with the updated reply payload', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await appfollowConnector.executeMutation!({
      source: source(),
      capabilityName: 'reply.update',
      args: { ext_id: 'app_1', review_id: 'rev_1', answer_text: 'thanks!' },
      idempotencyKey: 'k-up',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.appfollow.io/reviews/reply')
    expect(requestBody).toEqual({ ext_id: 'app_1', review_id: 'rev_1', answer_text: 'thanks!' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      appfollowConnector.executeMutation!({
        source: source(),
        capabilityName: 'reply.update',
        args: { ext_id: 'app_1', review_id: 'rev_1', answer_text: 'thanks!' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('appfollow reply.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /reviews/reply with ext_id + review_id as query params', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await appfollowConnector.executeMutation!({
      source: source(),
      capabilityName: 'reply.delete',
      args: { ext_id: 'app_1', review_id: 'rev_1' },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toContain('https://api.appfollow.io/reviews/reply')
    expect(requestUrl).toContain('ext_id=app_1')
    expect(requestUrl).toContain('review_id=rev_1')
    expect(result.status).toBe('committed')
  })
})

describe('appfollow tags.assign', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /tags with the ext_id, review_id, and tag', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await appfollowConnector.executeMutation!({
      source: source(),
      capabilityName: 'tags.assign',
      args: { ext_id: 'app_1', review_id: 'rev_1', tag: 'priority' },
      idempotencyKey: 'k-tag',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.appfollow.io/tags')
    expect(requestBody).toEqual({ ext_id: 'app_1', review_id: 'rev_1', tag: 'priority' })
    expect(result.status).toBe('committed')
  })
})
