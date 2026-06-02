import { afterEach, describe, expect, it, vi } from 'vitest'
import { beamerConnector } from '../src/connectors/adapters/beamer.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_beamer_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'beamer',
    label: 'Beamer test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'beamer-secret' },
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

describe('beamer adapter manifest', () => {
  it('classifies itself as the doc category and exposes the beamer kind', () => {
    expect(beamerConnector.manifest.kind).toBe('beamer')
    expect(beamerConnector.manifest.category).toBe('doc')
    expect(beamerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = beamerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set plus write-side update/delete capabilities', () => {
    const mutations = beamerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'comments.create',
        'comments.delete',
        'featureRequests.create',
        'featureRequests.update',
        'posts.create',
        'posts.delete',
        'posts.update',
        'votes.create',
      ].sort(),
    )
    const reads = beamerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('posts.query')
    expect(reads).toContain('featureRequests.query')
  })

  it('marks new mutations as native-idempotency external effect', () => {
    const caps = beamerConnector.manifest.capabilities
    for (const name of ['posts.update', 'posts.delete', 'comments.delete', 'featureRequests.update']) {
      const cap = caps.find((c) => c.name === name)!
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') return
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('beamer posts.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /v0/posts/{postId} with the changed fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'post-1', updated: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await beamerConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.update',
      args: {
        postId: 'post-1',
        title: 'New title',
        content: 'updated body',
        md: false,
        category: 'cat-1',
        visible: 'public',
        showInWidget: true,
        showInStandalone: true,
        enableFeedback: true,
        enableReactions: true,
        enableSocialShare: false,
        autoOpen: false,
      },
      idempotencyKey: 'k-upd-1',
    })

    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/v0/posts/post-1')
    expect(requestBody).toMatchObject({ title: 'New title', content: 'updated body' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      beamerConnector.executeMutation!({
        source: source(),
        capabilityName: 'posts.update',
        args: {
          postId: 'post-1',
          title: 'x',
          content: 'c',
          md: false,
          category: 'c1',
          visible: 'public',
          showInWidget: true,
          showInStandalone: true,
          enableFeedback: true,
          enableReactions: true,
          enableSocialShare: false,
          autoOpen: false,
        },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('beamer posts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v0/posts/{postId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await beamerConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.delete',
      args: { postId: 'post-9' },
      idempotencyKey: 'k-del-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v0/posts/post-9')
    expect(result.status).toBe('committed')
  })
})

describe('beamer comments.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v0/feature-requests/{featureRequestId}/comments/{commentId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await beamerConnector.executeMutation!({
      source: source(),
      capabilityName: 'comments.delete',
      args: { featureRequestId: 'fr-1', commentId: 'c-42' },
      idempotencyKey: 'k-del-2',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v0/feature-requests/fr-1/comments/c-42')
    expect(result.status).toBe('committed')
  })
})

describe('beamer featureRequests.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /v0/feature-requests/{featureRequestId} with status change', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'fr-1', status: 'planned' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await beamerConnector.executeMutation!({
      source: source(),
      capabilityName: 'featureRequests.update',
      args: {
        featureRequestId: 'fr-1',
        title: 'updated title',
        content: 'updated body',
        category: 'cat',
        status: 'planned',
      },
      idempotencyKey: 'k-upd-fr-1',
    })

    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/v0/feature-requests/fr-1')
    expect(requestBody).toMatchObject({ status: 'planned' })
    expect(result.status).toBe('committed')
  })
})
