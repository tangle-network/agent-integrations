import { afterEach, describe, expect, it, vi } from 'vitest'
import { beehiivConnector } from '../src/connectors/adapters/beehiiv.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_beehiiv_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'beehiiv',
    label: 'Beehiiv test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bh-secret' },
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

describe('beehiiv adapter manifest', () => {
  it('classifies itself as the crm category and exposes the beehiiv kind', () => {
    expect(beehiivConnector.manifest.kind).toBe('beehiiv')
    expect(beehiivConnector.manifest.category).toBe('crm')
    expect(beehiivConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = beehiivConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Beehiiv/i)
  })

  it('covers subscriptions + automations + posts + segments capability surface', () => {
    const names = beehiivConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'automations.list',
        'posts.create',
        'posts.list',
        'posts.publish',
        'segments.create',
        'subscriptions.add.to.automation',
        'subscriptions.create',
        'subscriptions.delete',
        'subscriptions.update',
      ].sort(),
    )
  })

  it('marks new mutations (subscriptions.delete, posts.create, posts.publish, segments.create) as native-idempotency external effect', () => {
    const caps = beehiivConnector.manifest.capabilities
    for (const name of ['subscriptions.delete', 'posts.create', 'posts.publish', 'segments.create']) {
      const cap = caps.find((c) => c.name === name)!
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') return
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('beehiiv subscriptions.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/publications/{publication_id}/subscriptions/{subscription_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await beehiivConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.delete',
      args: { publication_id: 'pub_1', subscription_id: 'sub_42' },
      idempotencyKey: 'k-del-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/publications/pub_1/subscriptions/sub_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      beehiivConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscriptions.delete',
        args: { publication_id: 'pub_1', subscription_id: 'sub_42' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('beehiiv posts.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/publications/{publication_id}/posts with the body fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'post_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await beehiivConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.create',
      args: {
        publication_id: 'pub_1',
        title: 'Hello',
        subtitle: 'sub',
        body_content: '<p>world</p>',
        status: 'draft',
        audience: 'free',
        platform: 'web',
      },
      idempotencyKey: 'k-pc-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/publications/pub_1/posts')
    expect(requestBody).toMatchObject({ title: 'Hello', body_content: '<p>world</p>', status: 'draft' })
    expect(result.status).toBe('committed')
  })
})

describe('beehiiv posts.publish', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/publications/{publication_id}/posts/{post_id}/publish', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'published' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await beehiivConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.publish',
      args: { publication_id: 'pub_1', post_id: 'post_1' },
      idempotencyKey: 'k-pub-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/publications/pub_1/posts/post_1/publish')
    expect(result.status).toBe('committed')
  })
})

describe('beehiiv segments.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/publications/{publication_id}/segments with name+type+filters', async () => {
    let requestUrl: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'seg_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await beehiivConnector.executeMutation!({
      source: source(),
      capabilityName: 'segments.create',
      args: {
        publication_id: 'pub_1',
        name: 'Active readers',
        type: 'dynamic',
        filters: { last_open: { lt_days: 7 } },
      },
      idempotencyKey: 'k-seg-1',
    })

    expect(String(requestUrl)).toContain('/v1/publications/pub_1/segments')
    expect(requestBody).toMatchObject({
      name: 'Active readers',
      type: 'dynamic',
      filters: { last_open: { lt_days: 7 } },
    })
    expect(result.status).toBe('committed')
  })

  it('rejects when required `name` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      beehiivConnector.executeMutation!({
        source: source(),
        capabilityName: 'segments.create',
        args: { publication_id: 'pub_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: name/)
  })
})
