import { afterEach, describe, expect, it, vi } from 'vitest'
import { base44Connector } from '../src/connectors/adapters/base44.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_base44_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'base44',
    label: 'Base44 test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'b44-secret' },
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

describe('base44 adapter manifest', () => {
  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = base44Connector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})

describe('base44 entities.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /api/v1/entities/{entityType}/{entityId} with the entity body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'row-1', updated: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await base44Connector.executeMutation!({
      source: source(),
      capabilityName: 'entities.update',
      args: { entityType: 'tasks', entityId: 'row-1', entityData: { status: 'done' } },
      idempotencyKey: 'k-upd-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/api/v1/entities/tasks/row-1')
    expect(requestBody).toEqual({ status: 'done' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      base44Connector.executeMutation!({
        source: source(),
        capabilityName: 'entities.update',
        args: { entityType: 'tasks', entityId: 'row-1', entityData: { status: 'done' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('base44 entities.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/entities/{entityType}/{entityId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await base44Connector.executeMutation!({
      source: source(),
      capabilityName: 'entities.delete',
      args: { entityType: 'tasks', entityId: 'row-1' },
      idempotencyKey: 'k-del-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v1/entities/tasks/row-1')
    expect(result.status).toBe('committed')
  })
})

describe('base44 entities.bulkUpsert', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v1/entities/{entityType}/bulkUpsert with the entities array', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ upserted: 2 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await base44Connector.executeMutation!({
      source: source(),
      capabilityName: 'entities.bulkUpsert',
      args: {
        entityType: 'tasks',
        entities: [
          { id: 'a', title: 'one' },
          { id: 'b', title: 'two' },
        ],
      },
      idempotencyKey: 'k-bulk-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/entities/tasks/bulkUpsert')
    expect(requestBody).toEqual({
      entities: [
        { id: 'a', title: 'one' },
        { id: 'b', title: 'two' },
      ],
    })
    expect(result.status).toBe('committed')
  })

  it('rejects when `entities` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      base44Connector.executeMutation!({
        source: source(),
        capabilityName: 'entities.bulkUpsert',
        args: { entityType: 'tasks' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: entities/)
  })
})
