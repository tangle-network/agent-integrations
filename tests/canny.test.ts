import { afterEach, describe, expect, it, vi } from 'vitest'
import { cannyConnector } from '../src/connectors/adapters/canny.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_canny_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'canny',
    label: 'Canny test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'canny_secret' },
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

describe('canny adapter manifest', () => {
  it('classifies itself with the canny kind and other category', () => {
    expect(cannyConnector.manifest.kind).toBe('canny')
    expect(cannyConnector.manifest.category).toBe('other')
    expect(cannyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = cannyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('includes the new write capabilities alongside the existing ones', () => {
    const names = cannyConnector.manifest.capabilities.map((c) => c.name)
    for (const expected of [
      'posts.create',
      'posts.retrieve',
      'posts.list',
      'posts.update',
      'posts.delete',
      'comments.create',
      'votes.create',
      'votes.delete',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('marks the new write capabilities as native-idempotency external effect', () => {
    const targets = ['posts.update', 'posts.delete', 'comments.create']
    for (const name of targets) {
      const cap = cannyConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('canny posts.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v1/posts/update with postID and supplied fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({})
      }),
    )
    const fullArgs = {
      postID: 'p1',
      title: 'new title',
      details: 'new details',
      eta: '06/2026',
      etaPublic: true,
      customFields: { priority: 'high' },
      imageURLs: ['https://example.com/i.png'],
    }
    const result = await cannyConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.update',
      args: fullArgs,
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/posts/update')
    expect(requestBody).toMatchObject({ postID: 'p1', title: 'new title', etaPublic: true })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      cannyConnector.executeMutation!({
        source: source(),
        capabilityName: 'posts.update',
        args: {
          postID: 'p1',
          title: 'new title',
          details: 'new details',
          eta: '06/2026',
          etaPublic: true,
          customFields: {},
          imageURLs: [],
        },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('canny posts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v1/posts/delete with postID', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({})
      }),
    )
    const result = await cannyConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.delete',
      args: { postID: 'p1' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/posts/delete')
    expect(requestBody).toEqual({ postID: 'p1' })
    expect(result.status).toBe('committed')
  })
})

describe('canny comments.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v1/comments/create with postID/authorID/value', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'c_1' })
      }),
    )
    const result = await cannyConnector.executeMutation!({
      source: source(),
      capabilityName: 'comments.create',
      args: {
        postID: 'p1',
        authorID: 'u1',
        value: 'Looks great',
        parentID: 'parent-1',
        imageURLs: [],
        internal: false,
        createdAt: '2026-06-02T00:00:00Z',
      },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/comments/create')
    expect(requestBody).toMatchObject({ postID: 'p1', authorID: 'u1', value: 'Looks great' })
    expect(result.status).toBe('committed')
  })
})
