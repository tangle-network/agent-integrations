import { afterEach, describe, expect, it, vi } from 'vitest'
import { couchbaseConnector } from '../src/connectors/adapters/couchbase.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_couchbase_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'couchbase',
    label: 'couchbase test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { clusterUrl: 'https://couchbase.example.com:18091' },
    credentials: { kind: 'api-key', apiKey: 'YWRtaW46c2VjcmV0' },
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

describe('couchbase document.upsert', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs the full document body to /buckets/.../docs/{docId} with the basic auth header', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestHeaders: Record<string, string> = {}
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await couchbaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'document.upsert',
      args: {
        bucket: 'travel-sample',
        scope: 'inventory',
        collection: 'airport',
        docId: 'airport_1234',
        content: { name: 'JFK', city: 'New York' },
      },
      idempotencyKey: 'k-upsert-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/buckets/travel-sample/scopes/inventory/collections/airport/docs/airport_1234')
    expect(requestHeaders.Authorization).toBe('Basic YWRtaW46c2VjcmV0')
    expect(requestBody).toEqual({ name: 'JFK', city: 'New York' })
  })
})

describe('couchbase index.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the CREATE INDEX statement to /query/service', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ results: [], status: 'success' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await couchbaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'index.create',
      args: { statement: 'CREATE PRIMARY INDEX ON `travel-sample`', timeout: '75s' },
      idempotencyKey: 'k-idx-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/query/service')
    expect(requestBody).toMatchObject({ statement: 'CREATE PRIMARY INDEX ON `travel-sample`', timeout: '75s' })
  })
})
