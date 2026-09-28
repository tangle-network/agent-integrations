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

describe('notion databases.update (partial updates)', () => {
  afterEach(() => vi.unstubAllGlobals())

  function captureMutation(): {
    run: (args: Record<string, unknown>) => Promise<unknown>
    seen: () => { url: string; method: string; body: unknown; headers: Record<string, string> }
  } {
    let url = ''
    let method = ''
    let body: unknown = null
    let headers: Record<string, string> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        method = init?.method ?? ''
        body = init?.body ? JSON.parse(init.body as string) : null
        headers = (init?.headers ?? {}) as Record<string, string>
        return jsonResponse({ object: 'database', id: 'db_1' })
      }),
    )
    return {
      run: (args) =>
        notionConnector.executeMutation!({
          source: source(),
          capabilityName: 'databases.update',
          args,
          idempotencyKey: 'k-db-update',
        }),
      seen: () => ({ url, method, body, headers }),
    }
  }

  it('title-only update PATCHes /databases/{id} without a properties key (no throw)', async () => {
    const cap = captureMutation()
    const title = [{ type: 'text', text: { content: 'Renamed' } }]
    const result = await cap.run({ databaseId: 'db_1', title })
    const { url, method, body, headers } = cap.seen()
    expect(method).toBe('PATCH')
    expect(url).toContain('/v1/databases/db_1')
    expect(body).toEqual({ title })
    expect(body).not.toHaveProperty('properties')
    // Regression guard for the Notion-Version requirement on the data surface.
    expect(headers['Notion-Version']).toBe('2022-06-28')
    expect((result as { status: string }).status).toBe('committed')
  })

  it('schema-only update PATCHes without a title key (no throw)', async () => {
    const cap = captureMutation()
    const properties = { Status: { select: { options: [{ name: 'Done' }] } } }
    await cap.run({ databaseId: 'db_1', properties })
    const { body } = cap.seen()
    expect(body).toEqual({ properties })
    expect(body).not.toHaveProperty('title')
  })

  it('sends both fields when both are provided', async () => {
    const cap = captureMutation()
    const title = [{ type: 'text', text: { content: 'X' } }]
    const properties = { Name: { title: {} } }
    await cap.run({ databaseId: 'db_1', title, properties })
    expect(cap.seen().body).toEqual({ title, properties })
  })
})
