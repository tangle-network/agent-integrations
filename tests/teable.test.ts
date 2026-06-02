import { afterEach, describe, expect, it, vi } from 'vitest'
import { teableConnector } from '../src/connectors/adapters/teable.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_teable_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'teable',
    label: 'teable test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'teable_access',
      refreshToken: 'teable_refresh',
      expiresAt: Date.now() + 3_600_000,
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

describe('teable adapter manifest', () => {
  it('classifies itself as the doc category and exposes the teable kind', () => {
    expect(teableConnector.manifest.kind).toBe('teable')
    expect(teableConnector.manifest.category).toBe('doc')
    expect(teableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = teableConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers records + attachments + tables/fields/views surface', () => {
    const names = teableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'attachments.upload',
        'fields.create',
        'records.create',
        'records.delete',
        'records.find',
        'records.get',
        'records.update',
        'tables.create',
        'tables.list',
        'views.create',
      ].sort(),
    )
    const reads = teableConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = teableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.find', 'records.get', 'tables.list'].sort())
    expect(mutations).toEqual(
      [
        'attachments.upload',
        'fields.create',
        'records.create',
        'records.delete',
        'records.update',
        'tables.create',
        'views.create',
      ].sort(),
    )
  })

  it('marks each newly added mutation as native-idempotency + externalEffect=true', () => {
    const targetNames = new Set(['tables.create', 'fields.create', 'views.create'])
    const mutations = teableConnector.manifest.capabilities.filter(
      (c) => c.class === 'mutation' && targetNames.has(c.name),
    )
    expect(mutations.length).toBe(3)
    for (const cap of mutations) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('teable tables.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /base/{baseId}/table and returns the parsed data', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse([{ id: 't_1', name: 'Tasks' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await teableConnector.executeRead!({
      source: source(),
      capabilityName: 'tables.list',
      args: { baseId: 'base_1' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/api/v1/base/base_1/table')
    expect(result.data).toEqual([{ id: 't_1', name: 'Tasks' }])
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      teableConnector.executeRead!({
        source: source(),
        capabilityName: 'tables.list',
        args: { baseId: 'base_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('teable tables.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /base/{baseId}/table with the table name', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 't_new', name: 'Inbox' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await teableConnector.executeMutation!({
      source: source(),
      capabilityName: 'tables.create',
      args: { baseId: 'base_1', name: 'Inbox' },
      idempotencyKey: 'k-2',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/base/base_1/table')
    expect(requestBody).toMatchObject({ name: 'Inbox' })
  })
})

describe('teable fields.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /table/{tableId}/field with the field name and type', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'f_1', name: 'Priority', type: 'singleSelect' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await teableConnector.executeMutation!({
      source: source(),
      capabilityName: 'fields.create',
      args: { tableId: 't_1', name: 'Priority', type: 'singleSelect' },
      idempotencyKey: 'k-3',
    })

    expect(String(requestUrl)).toContain('/api/v1/table/t_1/field')
    expect(requestBody).toMatchObject({ name: 'Priority', type: 'singleSelect' })
  })
})

describe('teable views.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /table/{tableId}/view with the view name and type', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'v_1', name: 'My Grid' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await teableConnector.executeMutation!({
      source: source(),
      capabilityName: 'views.create',
      args: { tableId: 't_1', name: 'My Grid', type: 'grid' },
      idempotencyKey: 'k-4',
    })

    expect(String(requestUrl)).toContain('/api/v1/table/t_1/view')
    expect(requestBody).toMatchObject({ name: 'My Grid', type: 'grid' })
  })
})
