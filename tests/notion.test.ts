import { afterEach, describe, expect, it, vi } from 'vitest'
import { notionConnector } from '../src/connectors/adapters/notion.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_notion_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'notion',
    label: 'notion test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'notion_token',
    },
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

describe('notion adapter manifest', () => {
  it('classifies itself as the doc category and exposes the notion kind', () => {
    expect(notionConnector.manifest.kind).toBe('notion')
    expect(notionConnector.manifest.category).toBe('doc')
    expect(notionConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = notionConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the activepieces action set plus users.list and block write-side ops', () => {
    const names = notionConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'databases.retrieve',
        'databases.query',
        'pages.create',
        'pages.retrieve',
        'pages.update',
        'pages.archive',
        'blocks.retrieve',
        'blocks.children',
        'blocks.append',
        'blocks.update',
        'blocks.delete',
        'comments.create',
        'comments.retrieve',
        'users.list',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency external effect', () => {
    const newMutations = ['blocks.update', 'blocks.delete']
    for (const name of newMutations) {
      const cap = notionConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      expect(cap!.class).toBe('mutation')
      if (cap!.class === 'mutation') {
        expect(cap!.cas).toBe('native-idempotency')
        expect(cap!.externalEffect).toBe(true)
      }
    }
  })
})

describe('notion users.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v1/users with optional pagination', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ results: [{ id: 'u_1', name: 'Drew' }], next_cursor: null })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await notionConnector.executeRead!({
      source: source(),
      capabilityName: 'users.list',
      args: { pageSize: 50 },
      idempotencyKey: 'k-list-users',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toContain('/v1/users')
    expect(capturedUrl).toContain('page_size=50')
    expect((result.data as { results: unknown[] }).results).toHaveLength(1)
  })

  it('works without any optional args', async () => {
    let capturedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ results: [], next_cursor: null })
    })
    vi.stubGlobal('fetch', fetchMock)

    await notionConnector.executeRead!({
      source: source(),
      capabilityName: 'users.list',
      args: {},
      idempotencyKey: 'k-list-users-2',
    })

    expect(capturedUrl).toContain('/v1/users')
    expect(capturedUrl).not.toContain('page_size=')
    expect(capturedUrl).not.toContain('start_cursor=')
  })
})

describe('notion blocks.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/blocks/{blockId} with the content payload', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ object: 'block', id: 'b_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const content = { paragraph: { rich_text: [{ type: 'text', text: { content: 'updated' } }] } }
    const result = await notionConnector.executeMutation!({
      source: source(),
      capabilityName: 'blocks.update',
      args: { blockId: 'b_1', content },
      idempotencyKey: 'k-block-update',
    })

    expect(capturedMethod).toBe('PATCH')
    expect(capturedUrl).toContain('/v1/blocks/b_1')
    expect(capturedBody).toEqual(content)
    expect(result.status).toBe('committed')
  })

  it('rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      notionConnector.executeMutation!({
        source: source(),
        capabilityName: 'blocks.update',
        args: { blockId: 'b_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: content/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      notionConnector.executeMutation!({
        source: source(),
        capabilityName: 'blocks.update',
        args: { blockId: 'b_1', content: { paragraph: { rich_text: [] } } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('notion blocks.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/blocks/{blockId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ object: 'block', id: 'b_1', archived: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await notionConnector.executeMutation!({
      source: source(),
      capabilityName: 'blocks.delete',
      args: { blockId: 'b_1' },
      idempotencyKey: 'k-block-del',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toContain('/v1/blocks/b_1')
    expect(result.status).toBe('committed')
  })

  it('handles a 204 No Content response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    const result = await notionConnector.executeMutation!({
      source: source(),
      capabilityName: 'blocks.delete',
      args: { blockId: 'b_1' },
      idempotencyKey: 'k-block-del-204',
    })
    expect(result.status).toBe('committed')
  })
})
