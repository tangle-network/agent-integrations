import { afterEach, describe, expect, it, vi } from 'vitest'
import { pocketbaseConnector } from '../src/connectors/adapters/pocketbase.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_pocketbase_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'pocketbase',
    label: 'pocketbase test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { host: 'https://pb.example.com' },
    credentials: { kind: 'api-key', apiKey: 'pocketbase_secret' },
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

describe('pocketbase adapter manifest', () => {
  it('classifies itself as the database category and exposes the pocketbase kind', () => {
    expect(pocketbaseConnector.manifest.kind).toBe('pocketbase')
    expect(pocketbaseConnector.manifest.category).toBe('database')
    expect(pocketbaseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = pocketbaseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/PocketBase/i)
  })

  it('covers record CRUD plus collections management', () => {
    const names = pocketbaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.list',
        'records.fullList',
        'records.get',
        'records.create',
        'records.update',
        'records.delete',
        'collections.list',
        'collections.create',
        'collections.delete',
      ].sort(),
    )
    const mutations = pocketbaseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['records.create', 'records.update', 'records.delete', 'collections.create', 'collections.delete'].sort(),
    )
  })

  it('marks the new write-side collections mutations as native-idempotency + externalEffect=true', () => {
    for (const name of ['collections.create', 'collections.delete']) {
      const cap = pocketbaseConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('pocketbase collections.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a GET to /api/collections under the configured host', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ items: [], page: 1, perPage: 30, totalItems: 0 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pocketbaseConnector.executeRead!({
      source: source(),
      capabilityName: 'collections.list',
      args: {},
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('GET')
    expect(requestUrl).toBe('https://pb.example.com/api/collections')
    expect(result.data).toMatchObject({ items: [] })
  })
})

describe('pocketbase collections.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the collection definition to /api/collections', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      return jsonResponse({ id: 'col_1', name: 'tasks', type: 'base' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pocketbaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'collections.create',
      args: { name: 'tasks', type: 'base' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://pb.example.com/api/collections')
    expect(requestBody).toMatchObject({ name: 'tasks', type: 'base' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      pocketbaseConnector.executeMutation!({
        source: source(),
        capabilityName: 'collections.create',
        args: { name: 'tasks' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('pocketbase collections.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/collections/{collection}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pocketbaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'collections.delete',
      args: { collection: 'tasks' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://pb.example.com/api/collections/tasks')
    expect(result.status).toBe('committed')
  })
})
