import { afterEach, describe, expect, it, vi } from 'vitest'
import { bikaConnector } from '../src/connectors/adapters/bika.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bika_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bika',
    label: 'Bika test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bika_secret' },
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

describe('bika adapter manifest', () => {
  it('classifies itself as the doc category and exposes the bika kind', () => {
    expect(bikaConnector.manifest.kind).toBe('bika')
    expect(bikaConnector.manifest.category).toBe('doc')
    expect(bikaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = bikaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Bika/i)
  })

  it('covers the records capability surface (single + batch) and tables.create', () => {
    const names = bikaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.create',
        'records.find',
        'records.get',
        'records.update',
        'records.delete',
        'records.batchCreate',
        'records.batchUpdate',
        'tables.create',
      ].sort(),
    )
    const mutations = bikaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'records.create',
        'records.update',
        'records.delete',
        'records.batchCreate',
        'records.batchUpdate',
        'tables.create',
      ].sort(),
    )
  })

  it('marks every new mutation as native-idempotency external effect', () => {
    const newMutations = new Set([
      'records.batchCreate',
      'records.batchUpdate',
      'tables.create',
    ])
    for (const c of bikaConnector.manifest.capabilities) {
      if (!newMutations.has(c.name)) continue
      expect(c.class).toBe('mutation')
      if (c.class !== 'mutation') throw new Error('unreachable')
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('bika adapter write execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a records.batchCreate payload at /v1/records/batch', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bikaConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.batchCreate',
      args: { records: [{ fields: { name: 'A' } }, { fields: { name: 'B' } }] },
      idempotencyKey: 'idem_bc',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.bika.ai/v1/records/batch')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({
      records: [{ fields: { name: 'A' } }, { fields: { name: 'B' } }],
    })
  })

  it('PATCHes records.batchUpdate at /v1/records/batch', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await bikaConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.batchUpdate',
      args: { records: [{ id: 'r1', fields: { name: 'A2' } }] },
      idempotencyKey: 'idem_bu',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.bika.ai/v1/records/batch')
  })

  it('POSTs tables.create scoped under the workspace path', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ id: 't_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await bikaConnector.executeMutation!({
      source: source(),
      capabilityName: 'tables.create',
      args: { workspaceId: 'ws_1', name: 'Backlog', fields: [{ name: 'title', type: 'text' }] },
      idempotencyKey: 'idem_tc',
    })

    expect(requestUrl).toBe('https://api.bika.ai/v1/workspaces/ws_1/tables')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({
      name: 'Backlog',
      fields: [{ name: 'title', type: 'text' }],
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      bikaConnector.executeMutation!({
        source: source(),
        capabilityName: 'tables.create',
        args: { workspaceId: 'ws_1', name: 'Backlog', fields: [] },
        idempotencyKey: 'idem_x',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
