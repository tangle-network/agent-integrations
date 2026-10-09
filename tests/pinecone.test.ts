import { afterEach, describe, expect, it, vi } from 'vitest'
import { pineconeConnector } from '../src/connectors/adapters/pinecone.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function pineconeSource(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_pinecone_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'pinecone',
    label: 'Pinecone test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'pcsk_test' },
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

describe('pinecone adapter manifest', () => {
  it('exposes control-plane index, collection, vector-data, and assistant capabilities', () => {
    const names = pineconeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'indexes.list',
        'indexes.describe',
        'indexes.create',
        'indexes.configure',
        'indexes.delete',
        'collections.list',
        'collections.describe',
        'collections.create',
        'collections.delete',
        'vectors.upsert',
        'vectors.query',
        'vectors.fetch',
        'vectors.update',
        'vectors.delete',
        'vectors.list',
        'vectors.describe_index_stats',
        'assistants.list',
        'assistants.describe',
        'assistants.create',
        'assistants.delete',
        'assistants.chat',
        'assistants.update',
        'assistants.files.delete',
        'backups.create',
      ].sort(),
    )
  })

  it('marks vectors.query and indexes.list as reads, upsert/delete/chat as mutations', () => {
    const byName = new Map(pineconeConnector.manifest.capabilities.map((c) => [c.name, c]))
    expect(byName.get('vectors.query')?.class).toBe('read')
    expect(byName.get('indexes.list')?.class).toBe('read')
    expect(byName.get('vectors.upsert')?.class).toBe('mutation')
    expect(byName.get('vectors.delete')?.class).toBe('mutation')
    expect(byName.get('assistants.chat')?.class).toBe('mutation')
  })

  it('marks generation (assistants.chat) as cas=none, idempotent ops as native-idempotency', () => {
    const byName = new Map(pineconeConnector.manifest.capabilities.map((c) => [c.name, c]))
    const chat = byName.get('assistants.chat')
    const upsert = byName.get('vectors.upsert')
    const indexCreate = byName.get('indexes.create')
    if (chat?.class !== 'mutation') throw new Error('assistants.chat must be a mutation')
    if (upsert?.class !== 'mutation') throw new Error('vectors.upsert must be a mutation')
    if (indexCreate?.class !== 'mutation') throw new Error('indexes.create must be a mutation')
    expect(chat.cas).toBe('none')
    expect(upsert.cas).toBe('native-idempotency')
    expect(indexCreate.cas).toBe('native-idempotency')
  })
})

describe('pinecone assistants.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes the assistant control-plane endpoint with the partial body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ name: 'support-bot', instructions: 'Be concise.' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pineconeConnector.executeMutation!({
      source: pineconeSource(),
      capabilityName: 'assistants.update',
      args: { assistantName: 'support-bot', instructions: 'Be concise.' },
      idempotencyKey: 'k-au-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toBe('https://api.pinecone.io/assistant/assistants/support-bot')
    const parsed = JSON.parse(requestBody ?? '{}') as Record<string, unknown>
    expect(parsed.instructions).toBe('Be concise.')
    expect(parsed).not.toHaveProperty('metadata')
  })
})

describe('pinecone assistants.files.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs the assistant file endpoint', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pineconeConnector.executeMutation!({
      source: pineconeSource(),
      capabilityName: 'assistants.files.delete',
      args: { assistantName: 'support-bot', assistantFileId: 'file_abc' },
      idempotencyKey: 'k-afd-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe(
      'https://api.pinecone.io/assistant/files/support-bot/file_abc',
    )
  })
})

describe('pinecone backups.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the index backups endpoint with the supplied body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ backupId: 'bk_1', name: 'nightly' }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await pineconeConnector.executeMutation!({
      source: pineconeSource(),
      capabilityName: 'backups.create',
      args: { indexName: 'prod-idx', name: 'nightly' },
      idempotencyKey: 'k-bc-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.pinecone.io/indexes/prod-idx/backups')
    const parsed = JSON.parse(requestBody ?? '{}') as Record<string, unknown>
    expect(parsed.name).toBe('nightly')
    expect(parsed.indexName).toBe('prod-idx')
  })
})


describe('Pinecone knowledge endpoint routing', () => {
  afterEach(() => vi.unstubAllGlobals())
  const host = 'https://docs-abc.svc.us-east1-gcp.pinecone.io'
  it('keeps management and probe requests on the control plane with an indexHost bound', async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ indexes: [] }))
    vi.stubGlobal('fetch', fetch)
    const source = pineconeSource({ metadata: { indexHost: host } })
    await pineconeConnector.test!(source)
    await pineconeConnector.executeRead!({ source, capabilityName: 'indexes.describe', args: { indexName: 'docs' }, idempotencyKey: 'describe' })
    await pineconeConnector.executeMutation!({ source, capabilityName: 'indexes.create', args: { name: 'docs', dimension: 3, metric: 'cosine', spec: { serverless: { cloud: 'aws', region: 'us-east-1' } } }, idempotencyKey: 'create' })
    expect(fetch.mock.calls.map(call => String(call[0]))).toEqual(['https://api.pinecone.io/indexes', 'https://api.pinecone.io/indexes/docs', 'https://api.pinecone.io/indexes'])
  })
  it('sends vector query, upsert and delete only to the bound data host', async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ matches: [] }))
    vi.stubGlobal('fetch', fetch)
    const source = pineconeSource({ metadata: { indexHost: host } })
    await pineconeConnector.executeRead!({ source, capabilityName: 'vectors.query', args: { namespace: 'kb', vector: [1, 0, 0], top_k: 3 }, idempotencyKey: 'query' })
    await pineconeConnector.executeMutation!({ source, capabilityName: 'vectors.upsert', args: { namespace: 'kb', vectors: [{ id: 'source-1', values: [1, 0, 0] }] }, idempotencyKey: 'upsert' })
    await pineconeConnector.executeMutation!({ source, capabilityName: 'vectors.delete', args: { namespace: 'kb', ids: ['source-1'] }, idempotencyKey: 'delete' })
    expect(fetch.mock.calls.map(call => String(call[0]))).toEqual([`${host}/query`, `${host}/vectors/upsert`, `${host}/vectors/delete`])
    for (const call of fetch.mock.calls) expect(call[1].redirect).toBe('error')
  })
  it.each([undefined, 'https://pinecone.io.attacker.example', 'http://docs.pinecone.io', 'https://127.0.0.1'])('rejects missing or untrusted index host %s before exposing credentials', async indexHost => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(pineconeConnector.executeRead!({ source: pineconeSource({ metadata: { indexHost } }), capabilityName: 'vectors.query', args: { vector: [1], top_k: 1 }, idempotencyKey: 'query' })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
