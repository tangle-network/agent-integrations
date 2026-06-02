import { afterEach, describe, expect, it, vi } from 'vitest'
import { circleConnector } from '../src/connectors/adapters/circle.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_circle_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'circle',
    label: 'Circle test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'circle_secret' },
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

describe('circle adapter manifest', () => {
  it('classifies itself as the comms category and exposes the circle kind', () => {
    expect(circleConnector.manifest.kind).toBe('circle')
    expect(circleConnector.manifest.category).toBe('comms')
    expect(circleConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = circleConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set including new write capabilities', () => {
    const names = circleConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'comments.create',
        'comments.delete',
        'members.find_by_email',
        'members.get',
        'members.remove',
        'posts.create',
        'posts.delete',
        'posts.get',
        'spaces.add_member',
        'spaces.create',
      ].sort(),
    )
    const reads = circleConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = circleConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['members.find_by_email', 'members.get', 'posts.get'])
    expect(mutations).toEqual(
      [
        'comments.create',
        'comments.delete',
        'members.remove',
        'posts.create',
        'posts.delete',
        'spaces.add_member',
        'spaces.create',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const cap of circleConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('circle posts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /posts/{post_id}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ success: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await circleConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.delete',
      args: { post_id: 42 },
      idempotencyKey: 'del-post-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://app.circle.so/api/v1/posts/42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      circleConnector.executeMutation!({
        source: source(),
        capabilityName: 'posts.delete',
        args: { post_id: 42 },
        idempotencyKey: 'del-post-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('circle spaces.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /spaces with name and space_group_id', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 99 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await circleConnector.executeMutation!({
      source: source(),
      capabilityName: 'spaces.create',
      args: { name: 'Newcomers', space_group_id: 7, visibility: 'public' },
      idempotencyKey: 'create-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://app.circle.so/api/v1/spaces')
    expect(capturedBody).toMatchObject({ name: 'Newcomers', space_group_id: 7, visibility: 'public' })
    expect(result.status).toBe('committed')
  })
})

describe('circle members.remove', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /space_members with space_id + email query', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ removed: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await circleConnector.executeMutation!({
      source: source(),
      capabilityName: 'members.remove',
      args: { space_id: 7, email: 'a@example.com' },
      idempotencyKey: 'remove-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toContain('https://app.circle.so/api/v1/space_members')
    expect(capturedUrl).toContain('space_id=7')
    expect(capturedUrl).toContain('email=a%40example.com')
    expect(result.status).toBe('committed')
  })
})
