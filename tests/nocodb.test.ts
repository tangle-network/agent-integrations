import { afterEach, describe, expect, it, vi } from 'vitest'
import { nocodbConnector } from '../src/connectors/adapters/nocodb.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_nocodb_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'nocodb',
    label: 'nocodb test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl: 'https://nocodb.example.com' },
    credentials: { kind: 'api-key', apiKey: 'nocodb_secret' },
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

describe('nocodb adapter manifest', () => {
  it('classifies itself as the database category and exposes the nocodb kind', () => {
    expect(nocodbConnector.manifest.kind).toBe('nocodb')
    expect(nocodbConnector.manifest.category).toBe('database')
    expect(nocodbConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = nocodbConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers records CRUD plus tables.list/create, fields.create, records.bulk-create', () => {
    const names = nocodbConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.search',
        'records.get',
        'records.create',
        'records.update',
        'records.delete',
        'records.bulk-create',
        'tables.list',
        'tables.create',
        'fields.create',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency external effect', () => {
    const newMutations = ['tables.create', 'fields.create', 'records.bulk-create']
    for (const name of newMutations) {
      const cap = nocodbConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      expect(cap!.class).toBe('mutation')
      if (cap!.class === 'mutation') {
        expect(cap!.cas).toBe('native-idempotency')
        expect(cap!.externalEffect).toBe(true)
      }
    }
  })
})

describe('nocodb tables.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/v1/db/meta/projects/{projectId}/tables', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ list: [{ id: 't1' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await nocodbConnector.executeRead!({
      source: source(),
      capabilityName: 'tables.list',
      args: { projectId: 'p_1' },
      idempotencyKey: 'k-list',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toContain('/api/v1/db/meta/projects/p_1/tables')
    expect((result.data as { list: unknown[] }).list).toHaveLength(1)
  })
})

describe('nocodb tables.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the table definition to /api/v1/db/meta/projects/{projectId}/tables', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 't_created', title: 'Customers' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const definition = { table_name: 'customers', title: 'Customers', columns: [] }
    const result = await nocodbConnector.executeMutation!({
      source: source(),
      capabilityName: 'tables.create',
      args: { projectId: 'p_1', definition },
      idempotencyKey: 'k-create-table',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/api/v1/db/meta/projects/p_1/tables')
    expect(capturedBody).toEqual(definition)
    expect(result.status).toBe('committed')
  })

  it('rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      nocodbConnector.executeMutation!({
        source: source(),
        capabilityName: 'tables.create',
        args: { projectId: 'p_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: definition/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      nocodbConnector.executeMutation!({
        source: source(),
        capabilityName: 'tables.create',
        args: { projectId: 'p_1', definition: { table_name: 't', title: 'T', columns: [] } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('nocodb fields.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the column definition to /api/v1/db/meta/tables/{tableId}/columns', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'col_1', title: 'Email' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const column = { column_name: 'email', title: 'Email', uidt: 'Email' }
    const result = await nocodbConnector.executeMutation!({
      source: source(),
      capabilityName: 'fields.create',
      args: { tableId: 't_1', column },
      idempotencyKey: 'k-add-field',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/api/v1/db/meta/tables/t_1/columns')
    expect(capturedBody).toEqual(column)
    expect(result.status).toBe('committed')
  })
})

describe('nocodb records.bulk-create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs an array of records to /api/v1/db/data/bulk/noco/{tableId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse([{ Id: 1 }, { Id: 2 }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const records = [
      { Title: 'A', Email: 'a@example.com' },
      { Title: 'B', Email: 'b@example.com' },
    ]
    const result = await nocodbConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.bulk-create',
      args: { tableId: 't_1', records },
      idempotencyKey: 'k-bulk',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/api/v1/db/data/bulk/noco/t_1')
    expect(capturedBody).toEqual(records)
    expect(result.status).toBe('committed')
  })

  it('rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      nocodbConnector.executeMutation!({
        source: source(),
        capabilityName: 'records.bulk-create',
        args: { tableId: 't_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: records/)
  })
})
