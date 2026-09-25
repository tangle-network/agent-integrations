import { afterEach, describe, expect, it, vi } from 'vitest'
import { blueskyConnector } from '../src/connectors/adapters/bluesky.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bluesky_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bluesky',
    label: 'Bluesky test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bluesky_jwt' },
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

describe('bluesky adapter manifest', () => {
  it('uses api-key auth (the createSession-derived bearer mirrors the activepieces piece auth shape)', () => {
    const auth = blueskyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})

describe('bluesky adapter write execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs post.delete to com.atproto.repo.deleteRecord with the post collection', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await blueskyConnector.executeMutation!({
      source: source(),
      capabilityName: 'post.delete',
      args: { repo: 'did:plc:abc', rkey: 'rk1' },
      idempotencyKey: 'idem_pd',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://bsky.social/xrpc/com.atproto.repo.deleteRecord')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({
      repo: 'did:plc:abc',
      collection: 'app.bsky.feed.post',
      rkey: 'rk1',
    })
  })

  it('POSTs follow.user with a follow record under app.bsky.graph.follow', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ uri: 'at://did:plc:abc/app.bsky.graph.follow/r2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await blueskyConnector.executeMutation!({
      source: source(),
      capabilityName: 'follow.user',
      args: {
        repo: 'did:plc:abc',
        subject: 'did:plc:target',
        createdAt: '2026-06-02T00:00:00Z',
      },
      idempotencyKey: 'idem_f',
    })

    expect(requestUrl).toBe('https://bsky.social/xrpc/com.atproto.repo.createRecord')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({
      repo: 'did:plc:abc',
      collection: 'app.bsky.graph.follow',
      record: {
        $type: 'app.bsky.graph.follow',
        subject: 'did:plc:target',
        createdAt: '2026-06-02T00:00:00Z',
      },
    })
  })

  it('POSTs unfollow.user as deleteRecord against the follow rkey', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await blueskyConnector.executeMutation!({
      source: source(),
      capabilityName: 'unfollow.user',
      args: { repo: 'did:plc:abc', rkey: 'r2' },
      idempotencyKey: 'idem_u',
    })

    expect(requestUrl).toBe('https://bsky.social/xrpc/com.atproto.repo.deleteRecord')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({
      repo: 'did:plc:abc',
      collection: 'app.bsky.graph.follow',
      rkey: 'r2',
    })
  })

  it('POSTs mute.user to app.bsky.graph.muteActor', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await blueskyConnector.executeMutation!({
      source: source(),
      capabilityName: 'mute.user',
      args: { actor: 'did:plc:target' },
      idempotencyKey: 'idem_m',
    })

    expect(requestUrl).toBe('https://bsky.social/xrpc/app.bsky.graph.muteActor')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({ actor: 'did:plc:target' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      blueskyConnector.executeMutation!({
        source: source(),
        capabilityName: 'mute.user',
        args: { actor: 'did:plc:target' },
        idempotencyKey: 'idem_x',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
