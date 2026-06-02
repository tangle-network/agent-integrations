import { afterEach, describe, expect, it, vi } from 'vitest'
import { snowflakeConnector } from '../src/connectors/adapters/snowflake.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_snowflake_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'snowflake',
    label: 'snowflake test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'snow_token' },
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

describe('snowflake adapter manifest', () => {
  it('classifies itself as the database category and exposes the snowflake kind', () => {
    expect(snowflakeConnector.manifest.kind).toBe('snowflake')
    expect(snowflakeConnector.manifest.category).toBe('database')
    expect(snowflakeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with Snowflake-specific endpoints', () => {
    const auth = snowflakeConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/snowflake/)
    expect(auth.tokenUrl).toMatch(/snowflake/)
  })

  it('covers queries, rows, tables, procedures, stages, warehouses, and dynamic tables capability surface', () => {
    const names = snowflakeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('queries.run')
    expect(names).toContain('queries.runMultiple')
    expect(names).toContain('rows.insert')
    expect(names).toContain('rows.insertMultiple')
    expect(names).toContain('rows.update')
    expect(names).toContain('rows.upsert')
    expect(names).toContain('rows.delete')
    expect(names).toContain('rows.getById')
    expect(names).toContain('rows.search')
    expect(names).toContain('tables.list')
    expect(names).toContain('tables.getSchema')
    expect(names).toContain('tables.create')
    expect(names).toContain('tables.drop')
    expect(names).toContain('procedures.execute')
    expect(names).toContain('stages.loadData')
    expect(names).toContain('stages.create')
    expect(names).toContain('stages.unloadData')
    expect(names).toContain('warehouses.list')
    expect(names).toContain('dynamicTables.create')
  })

  it('marks write operations as mutations', () => {
    const mutations = snowflakeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('rows.insert')
    expect(mutations).toContain('rows.insertMultiple')
    expect(mutations).toContain('rows.update')
    expect(mutations).toContain('rows.upsert')
    expect(mutations).toContain('rows.delete')
    expect(mutations).toContain('procedures.execute')
    expect(mutations).toContain('stages.loadData')
    expect(mutations).toContain('stages.create')
    expect(mutations).toContain('stages.unloadData')
    expect(mutations).toContain('tables.create')
    expect(mutations).toContain('tables.drop')
    expect(mutations).toContain('dynamicTables.create')
  })

  it('marks read-only operations as read', () => {
    const reads = snowflakeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('queries.run')
    expect(reads).toContain('queries.runMultiple')
    expect(reads).toContain('rows.getById')
    expect(reads).toContain('rows.search')
    expect(reads).toContain('tables.list')
    expect(reads).toContain('tables.getSchema')
    expect(reads).toContain('warehouses.list')
  })

  it('every mutation declares native-idempotency CAS and externalEffect true (default added by declarative-rest)', () => {
    for (const c of snowflakeConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      // declarative-rest defaults mutation cas to native-idempotency when omitted;
      // every write Snowflake op in this adapter uses that or an explicit upgrade.
      expect(['native-idempotency', 'optimistic-read-verify', 'etag-if-match']).toContain(c.cas)
      expect(c.externalEffect).toBe(true)
    }
  })

  it('the newly added write capabilities all declare native-idempotency + external effect', () => {
    const newCaps = ['tables.create', 'tables.drop', 'stages.create', 'stages.unloadData']
    for (const name of newCaps) {
      const cap = snowflakeConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} should be mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('snowflake tables.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the schema tables endpoint with name + columns body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'tbl_1', name: 'ORDERS' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await snowflakeConnector.executeMutation!({
      source: source(),
      capabilityName: 'tables.create',
      args: {
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        name: 'ORDERS',
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'created_at', type: 'TIMESTAMP_NTZ' },
        ],
      },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v2/databases/ANALYTICS/schemas/PUBLIC/tables')
    expect(requestBody).toBeDefined()
    const parsed = JSON.parse(requestBody!) as Record<string, unknown>
    expect(parsed.name).toBe('ORDERS')
    expect(Array.isArray(parsed.columns)).toBe(true)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      snowflakeConnector.executeMutation!({
        source: source(),
        capabilityName: 'tables.create',
        args: { database: 'D', schema: 'S', name: 'T', columns: [{ name: 'id', type: 'NUMBER' }] },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('snowflake tables.drop', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE on the table resource', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await snowflakeConnector.executeMutation!({
      source: source(),
      capabilityName: 'tables.drop',
      args: { database: 'D', schema: 'S', table: 'T' },
      idempotencyKey: 'k-2',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v2/databases/D/schemas/S/tables/T')
  })
})

describe('snowflake stages.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the schema stages endpoint and forwards args as body', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'stg_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await snowflakeConnector.executeMutation!({
      source: source(),
      capabilityName: 'stages.create',
      args: { database: 'D', schema: 'S', name: 'INTAKE_STAGE' },
      idempotencyKey: 'k-3',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/api/v2/databases/D/schemas/S/stages')
    expect(requestBody).toBeDefined()
    const parsed = JSON.parse(requestBody!) as Record<string, unknown>
    expect(parsed.name).toBe('INTAKE_STAGE')
  })
})

describe('snowflake stages.unloadData', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the table unload endpoint', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ filesWritten: 3 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await snowflakeConnector.executeMutation!({
      source: source(),
      capabilityName: 'stages.unloadData',
      args: { database: 'D', schema: 'S', table: 'T', stage: '@INTAKE_STAGE' },
      idempotencyKey: 'k-4',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/api/v2/databases/D/schemas/S/tables/T/unload')
  })
})

describe('snowflake warehouses.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues GET /warehouses', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse([{ name: 'COMPUTE_WH' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await snowflakeConnector.executeRead!({
      source: source(),
      capabilityName: 'warehouses.list',
      args: {},
      idempotencyKey: 'k-5',
    })
    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/api/v2/warehouses')
    expect(result.data).toEqual([{ name: 'COMPUTE_WH' }])
  })

  it('threads the optional `like` filter into the query string', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    await snowflakeConnector.executeRead!({
      source: source(),
      capabilityName: 'warehouses.list',
      args: { like: 'COMPUTE%' },
      idempotencyKey: 'k-6',
    })
    expect(String(requestUrl)).toContain('like=COMPUTE')
  })
})
