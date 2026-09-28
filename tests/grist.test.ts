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
