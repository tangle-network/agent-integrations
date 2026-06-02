import { afterEach, describe, expect, it, vi } from 'vitest'
import { weaviateConnector } from '../src/connectors/adapters/weaviate.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_weaviate_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'weaviate',
    label: 'Weaviate test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { clusterUrl: 'https://example.weaviate.network' },
    credentials: { kind: 'api-key', apiKey: 'weaviate_secret' },
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

describe('weaviate adapter manifest', () => {
  it('exposes the weaviate kind, "storage" category, and authoritative consistency', () => {
    expect(weaviateConnector.manifest.kind).toBe('weaviate')
    expect(weaviateConnector.manifest.category).toBe('storage')
    expect(weaviateConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (weaviate cloud / api-key auth module)', () => {
    const auth = weaviateConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/api key/i)
  })

  it('covers schema, objects, graphql, batch, meta, nodes, classes.update, shards, and backups surfaces', () => {
    const names = weaviateConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'schema.list',
        'schema.get',
        'schema.create',
        'schema.delete',
        'objects.list',
        'objects.get',
        'objects.create',
        'objects.update',
        'objects.replace',
        'objects.delete',
        'graphql.query',
        'batch.objects.create',
        'batch.objects.delete',
        'meta.get',
        'nodes.list',
        'classes.update',
        'schema.shards',
        'backups.create',
        'backups.restore',
      ].sort(),
    )
  })

  it('marks schema.create and batch ops as cas="none" (server does not dedupe)', () => {
    const byName = new Map(weaviateConnector.manifest.capabilities.map((c) => [c.name, c]))
    const schemaCreate = byName.get('schema.create')
    const batchCreate = byName.get('batch.objects.create')
    const batchDelete = byName.get('batch.objects.delete')
    const objectsCreate = byName.get('objects.create')
    if (
      !schemaCreate ||
      schemaCreate.class !== 'mutation' ||
      !batchCreate ||
      batchCreate.class !== 'mutation' ||
      !batchDelete ||
      batchDelete.class !== 'mutation' ||
      !objectsCreate ||
      objectsCreate.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(schemaCreate.cas).toBe('none')
    expect(batchCreate.cas).toBe('none')
    expect(batchDelete.cas).toBe('none')
    expect(objectsCreate.cas).toBe('native-idempotency')
  })

  it('marks classes.update + backups.create + backups.restore as native-idempotency + external-effect', () => {
    const byName = new Map(weaviateConnector.manifest.capabilities.map((c) => [c.name, c]))
    for (const name of ['classes.update', 'backups.create', 'backups.restore']) {
      const cap = byName.get(name)
      if (!cap || cap.class !== 'mutation') throw new Error(`missing mutation: ${name}`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('weaviate classes.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues PUT /v1/schema/{className} with the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(String(init.body)) : null
        return jsonResponse({ class: 'Article' })
      }),
    )
    const result = await weaviateConnector.executeMutation!({
      source: source(),
      capabilityName: 'classes.update',
      args: { className: 'Article', class: 'Article', description: 'updated' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/v1/schema/Article')
    expect(requestBody).toMatchObject({ class: 'Article', description: 'updated' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      weaviateConnector.executeMutation!({
        source: source(),
        capabilityName: 'classes.update',
        args: { className: 'Article', class: 'Article' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('weaviate schema.shards', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues GET /v1/schema/{className}/shards', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse([{ name: 'shard-0', status: 'READY' }])
      }),
    )
    const result = await weaviateConnector.executeRead!({
      source: source(),
      capabilityName: 'schema.shards',
      args: { className: 'Article' },
      idempotencyKey: 'k-shards-1',
    })
    expect(result.data).toEqual([{ name: 'shard-0', status: 'READY' }])
    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/v1/schema/Article/shards')
  })
})

describe('weaviate backups.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues POST /v1/backups/{backend} with the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(String(init.body)) : null
        return jsonResponse({ id: 'snap-1', status: 'STARTED' })
      }),
    )
    const result = await weaviateConnector.executeMutation!({
      source: source(),
      capabilityName: 'backups.create',
      args: { backend: 's3', id: 'snap-1' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/backups/s3')
    expect(requestBody).toMatchObject({ id: 'snap-1' })
  })
})

describe('weaviate backups.restore', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues POST /v1/backups/{backend}/{id}/restore', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ id: 'snap-1', status: 'STARTED' })
      }),
    )
    const result = await weaviateConnector.executeMutation!({
      source: source(),
      capabilityName: 'backups.restore',
      args: { backend: 's3', id: 'snap-1' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/backups/s3/snap-1/restore')
  })
})
