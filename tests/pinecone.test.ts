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
  it('identifies as kind=pinecone, category=other, authoritative consistency', () => {
    expect(pineconeConnector.manifest.kind).toBe('pinecone')
    expect(pineconeConnector.manifest.category).toBe('other')
    expect(pineconeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(pineconeConnector.manifest.displayName).toBe('Pinecone')
  })

  it('uses api-key auth (Pinecone exposes no 3-legged OAuth)', () => {
    const auth = pineconeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    // Hint must point the operator at the right console + flag the per-project key scope.
    expect(auth.hint).toMatch(/pcsk_/)
    expect(auth.hint).toMatch(/indexHost/)
  })

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

  it('marks newly added write capabilities as native-idempotency + externalEffect=true', () => {
    const newOnes = new Set(['assistants.update', 'assistants.files.delete', 'backups.create'])
    for (const cap of pineconeConnector.manifest.capabilities) {
      if (!newOnes.has(cap.name)) continue
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      pineconeConnector.executeMutation!({
        source: pineconeSource(),
        capabilityName: 'assistants.update',
        args: { assistantName: 'support-bot', instructions: 'x' },
        idempotencyKey: 'k-au-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
