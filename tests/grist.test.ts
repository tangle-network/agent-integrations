import { afterEach, describe, expect, it, vi } from 'vitest'
import { gristConnector } from '../src/connectors/adapters/grist.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_grist_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'grist',
    label: 'grist test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { domain: 'https://example.getgrist.com' },
    credentials: { kind: 'api-key', apiKey: 'grist_secret' },
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

describe('grist adapter manifest', () => {
  it('classifies itself under the doc category and exposes the grist kind', () => {
    expect(gristConnector.manifest.kind).toBe('grist')
    expect(gristConnector.manifest.category).toBe('doc')
    expect(gristConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares an api-key auth surface with domain URL hint', () => {
    const auth = gristConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Grist/i)
    expect(auth.hint).toMatch(/Domain/)
  })

  it('covers create/update/search/attachment plus add/delete/tables.create capabilities', () => {
    const names = gristConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.create',
        'records.update',
        'records.search',
        'attachments.upload',
        'records.add',
        'records.delete',
        'tables.create',
      ].sort(),
    )

    const reads = gristConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = gristConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.search'].sort())
    expect(mutations).toEqual(
      [
        'records.create',
        'records.update',
        'attachments.upload',
        'records.add',
        'records.delete',
        'tables.create',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['records.add', 'records.delete', 'tables.create']
    for (const name of expected) {
      const cap = gristConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('grist records.add', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/docs/{docId}/tables/{tableId}/records with the records array', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ records: [{ id: 1 }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gristConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.add',
      args: {
        docId: 'doc_1',
        tableId: 'Table1',
        records: [{ fields: { Name: 'A' } }],
      },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toBe(
      'https://example.getgrist.com/api/docs/doc_1/tables/Table1/records',
    )
    expect(requestBody).toMatchObject({ records: [{ fields: { Name: 'A' } }] })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      gristConnector.executeMutation!({
        source: source(),
        capabilityName: 'records.add',
        args: { docId: 'doc_1', tableId: 'Table1', records: [{ fields: { Name: 'A' } }] },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('grist records.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/docs/{docId}/tables/{tableId}/data/delete with the id array', async () => {
    let requestUrl: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await gristConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.delete',
      args: { docId: 'doc_1', tableId: 'Table1', recordIds: [1, 2, 3] },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toBe(
      'https://example.getgrist.com/api/docs/doc_1/tables/Table1/data/delete',
    )
    expect(requestBody).toEqual([1, 2, 3])
  })
})

describe('grist tables.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/docs/{docId}/tables with a tables payload', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ tables: [{ id: 'Table2' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await gristConnector.executeMutation!({
      source: source(),
      capabilityName: 'tables.create',
      args: {
        docId: 'doc_1',
        tableId: 'Table2',
        columns: [{ id: 'Name', fields: { label: 'Name', type: 'Text' } }],
      },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toBe('https://example.getgrist.com/api/docs/doc_1/tables')
    expect(requestBody).toMatchObject({
      tables: [
        { id: 'Table2', columns: [{ id: 'Name', fields: { label: 'Name', type: 'Text' } }] },
      ],
    })
  })
})
