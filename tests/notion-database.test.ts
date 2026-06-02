import { afterEach, describe, expect, it, vi } from 'vitest'
import { notionDatabase } from '../src/connectors/adapters/notion-database.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const adapter = notionDatabase({ clientId: 'cid', clientSecret: 'sec' })

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_notion_db_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'notion-database',
    label: 'Notion DB test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { databaseId: 'db_123' },
    credentials: { kind: 'oauth2', accessToken: 'at_notion' },
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

describe('notion-database adapter manifest', () => {
  it('marks new mutations as native-idempotency external effect', () => {
    const caps = adapter.manifest.capabilities
    const newMutations = ['pages.archive', 'databases.create', 'databases.update', 'blocks.append']
    for (const name of newMutations) {
      const cap = caps.find((c) => c.name === name)
      expect(cap, `expected capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('exposes the documented write-side capability surface', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('pages.archive')
    expect(names).toContain('databases.create')
    expect(names).toContain('databases.update')
    expect(names).toContain('blocks.append')
  })
})

describe('notion-database pages.archive', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /pages/{id} with archived:true and forwards the idempotency key', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestHeaders: Headers | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestHeaders = new Headers(init?.headers)
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ id: 'page_1', last_edited_time: '2026-06-01T00:00:00.000Z', archived: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'pages.archive',
      args: { pageId: 'page_1' },
      idempotencyKey: 'k-archive-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/pages/page_1')
    expect(requestHeaders?.get('Idempotency-Key') ?? requestHeaders?.get('idempotency-key')).toBe('k-archive-1')
    expect(requestBody).toEqual({ archived: true })
    if (result.status !== 'committed') throw new Error('unreachable')
    expect((result.data as { archived: boolean }).archived).toBe(true)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'pages.archive',
        args: { pageId: 'page_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('notion-database databases.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /databases with the parent page wrapper', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ id: 'db_new', url: 'https://notion.so/db_new', last_edited_time: '2026-06-01T00:00:00.000Z' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const title = [{ type: 'text', text: { content: 'Tasks' } }]
    const properties = { Name: { title: {} } }
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'databases.create',
      args: { parentPageId: 'page_parent', title, properties },
      idempotencyKey: 'k-create-db-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/databases')
    expect(requestBody).toEqual({
      parent: { type: 'page_id', page_id: 'page_parent' },
      title,
      properties,
    })
    if (result.status !== 'committed') throw new Error('unreachable')
    expect((result.data as { databaseId: string }).databaseId).toBe('db_new')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'databases.create',
        args: { parentPageId: 'p1', title: [], properties: {} },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('notion-database databases.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /databases/{id} with only the provided fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ id: 'db_123', last_edited_time: '2026-06-01T00:00:00.000Z' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const title = [{ type: 'text', text: { content: 'Renamed' } }]
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'databases.update',
      args: { databaseId: 'db_123', title },
      idempotencyKey: 'k-upd-db-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/databases/db_123')
    expect(requestBody).toEqual({ title })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'databases.update',
        args: { databaseId: 'db_123' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('notion-database blocks.append', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /blocks/{id}/children with the children array', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ results: [{ id: 'block_a' }, { id: 'block_b' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const children = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }]
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'blocks.append',
      args: { blockId: 'page_1', children },
      idempotencyKey: 'k-append-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/blocks/page_1/children')
    expect(requestBody).toEqual({ children })
    if (result.status !== 'committed') throw new Error('unreachable')
    expect((result.data as { results: Array<{ id: string }> }).results).toHaveLength(2)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'blocks.append',
        args: { blockId: 'page_1', children: [] },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
