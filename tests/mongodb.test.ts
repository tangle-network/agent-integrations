import type { LookupFunction } from 'node:net'
import type { MongoClientOptions } from 'mongodb'
import { describe, expect, it, vi } from 'vitest'
import { CONNECTOR_ADAPTER_FACTORIES } from '../src/connectors/adapters/factories.js'
import {
  createMongoDbConnector,
  mongodbConnector,
  type MongoDbConnectorOptions,
} from '../src/connectors/adapters/mongodb.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/index.js'

describe('MongoDB connector', () => {
  it('replaces the Data API placeholder with a valid authoritative read-only wire surface', () => {
    expect(validateConnectorManifest(mongodbConnector.manifest)).toEqual({ ok: true, issues: [] })
    expect(mongodbConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'mongodb.collections.list',
      'mongodb.collections.describe',
      'mongodb.indexes.list',
      'mongodb.documents.find',
      'mongodb.documents.count',
    ])
    expect(mongodbConnector.manifest.capabilities.every((capability) => capability.class === 'read')).toBe(true)
  })

  it('exposes executable structured-secret setup and a no-shared-secret factory', () => {
    expect(getIntegrationSpec('mongodb')).toMatchObject({
      status: 'executable',
      setup: { credentialFields: [{ label: 'MongoDB connection JSON', secret: true }] },
    })
    const factory = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === 'mongodb')
    expect(factory?.envMap).toEqual({})
    expect(factory?.factory({}).manifest.kind).toBe('mongodb')
  })

  it('pins public DNS while retaining verified TLS identity and keeping secrets out of the URI', async () => {
    let uri = ''
    let options: MongoClientOptions | undefined
    const connector = createMongoDbConnector({
      resolveHost: async () => ['203.0.113.10'],
      createClient: (nextUri, nextOptions) => {
        uri = nextUri
        options = nextOptions
        return fakeClient()
      },
    })
    await expect(connector.test(source())).resolves.toEqual({ ok: true })
    expect(uri).toBe('mongodb://mongo.example.com:27017/')
    expect(uri).not.toContain('not-a-real-secret')
    expect(options).toMatchObject({
      appName: 'tangle-integration-hub',
      auth: { username: 'integration', password: 'not-a-real-secret' },
      authSource: 'admin',
      directConnection: true,
      maxPoolSize: 1,
      rejectUnauthorized: true,
      retryWrites: false,
      servername: 'mongo.example.com',
      tls: true,
    })
    expect(options?.secureContext).toBeDefined()
    await expect(resolveLookup(options!.lookup!)).resolves.toEqual({ address: '203.0.113.10', family: 4 })
  })

  it('builds only fixed scalar predicates, projections, sorts, and server-side limits', async () => {
    const find = fakeFindCursor([{ id: 1, state: 'active' }])
    const collection = {
      find: vi.fn(() => find.cursor),
      countDocuments: vi.fn(async () => 1),
      listIndexes: vi.fn(() => fakeCursor([]).cursor),
    }
    const connector = connectorWith(fakeClient({
      db: () => fakeDatabase({ collection: () => collection }),
    }))
    const response = await connector.executeRead!({
      source: source(),
      capabilityName: 'mongodb.documents.find',
      args: {
        collection: 'accounts',
        filters: [{ field: 'state', operator: 'eq', value: 'active' }],
        fields: ['id', 'state'],
        includeId: false,
        sort: [{ field: 'id', direction: 'desc' }],
        skip: 2,
        limit: 10,
      },
      idempotencyKey: 'mongodb-find-1',
    })
    expect(collection.find).toHaveBeenCalledWith(
      { $and: [{ state: { $eq: 'active' } }] },
      { projection: { id: 1, state: 1, _id: 0 }, maxTimeMS: 30_000 },
    )
    expect(find.sort).toHaveBeenCalledWith({ id: -1 })
    expect(find.skip).toHaveBeenCalledWith(2)
    expect(find.limit).toHaveBeenCalledWith(10)
    expect(find.close).toHaveBeenCalledOnce()
    expect(response.data).toEqual({ collection: 'accounts', documents: [{ id: 1, state: 'active' }] })
  })

  it('closes metadata cursors and rejects provider pages beyond the configured bound', async () => {
    const entries = Array.from({ length: 1_001 }, (_, index) => ({ name: `collection_${index}` }))
    const page = fakeCursor(entries)
    const connector = connectorWith(fakeClient({
      db: () => fakeDatabase({ listCollections: () => page.cursor }),
    }))
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'mongodb.collections.list',
      args: {},
      idempotencyKey: 'mongodb-bounded-collections',
    })).rejects.toThrow('MongoDB collection list exceeds 1000 entries')
    expect(page.close).toHaveBeenCalledOnce()
  })

  it('stops streaming and closes the cursor when provider documents exceed the byte bound', async () => {
    const page = fakeFindCursor([{ payload: 'x'.repeat(10 * 1024 * 1024) }])
    const connector = connectorWith(fakeClient({
      db: () => fakeDatabase({
        collection: () => ({
          find: () => page.cursor,
          countDocuments: async () => 0,
          listIndexes: () => fakeCursor([]).cursor,
        }),
      }),
    }))
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'mongodb.documents.find',
      args: { collection: 'accounts' },
      idempotencyKey: 'mongodb-bounded-bytes',
    })).rejects.toThrow('MongoDB document result exceeds the 10485760-byte limit')
    expect(page.close).toHaveBeenCalledOnce()
  })

  it('rejects query injection and private or command targets before creating a client', async () => {
    const resolveHost = vi.fn(async () => ['203.0.113.10'])
    const createClient = vi.fn(() => fakeClient())
    const connector = createMongoDbConnector({ resolveHost, createClient })
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'mongodb.documents.find',
      args: { collection: 'accounts', filters: [{ field: '$where', operator: 'eq', value: 'sleep(10000)' }] },
      idempotencyKey: 'mongodb-injection',
    })).rejects.toThrow('filters[0].field must be a dotted MongoDB field path')
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'mongodb.documents.find',
      args: { collection: '$cmd' },
      idempotencyKey: 'mongodb-command-namespace',
    })).rejects.toThrow('collection must not target MongoDB system or command namespaces')
    await expect(connector.test(source({ host: '127.0.0.1' }))).resolves.toMatchObject({ ok: false })
    expect(resolveHost).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('redacts the password from driver failures', async () => {
    const connector = createMongoDbConnector({
      resolveHost: async () => ['203.0.113.10'],
      createClient: () => fakeClient({ connect: async () => { throw new Error('login failed for not-a-real-secret') } }),
    })
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'mongodb.collections.list',
      args: {},
      idempotencyKey: 'mongodb-redact',
    })).rejects.toThrow('login failed for [REDACTED]')
  })
})

type MongoClientLikeForTest = ReturnType<NonNullable<MongoDbConnectorOptions['createClient']>>
type MongoDatabaseLikeForTest = ReturnType<MongoClientLikeForTest['db']>
type MongoCursorLikeForTest = ReturnType<MongoDatabaseLikeForTest['listCollections']>
type MongoCollectionLikeForTest = ReturnType<MongoDatabaseLikeForTest['collection']>
type MongoFindCursorLikeForTest = ReturnType<MongoCollectionLikeForTest['find']>

function connectorWith(client: MongoClientLikeForTest) {
  return createMongoDbConnector({
    resolveHost: async () => ['203.0.113.10'],
    createClient: () => client,
  })
}

function fakeClient(overrides: Partial<MongoClientLikeForTest> = {}): MongoClientLikeForTest {
  return {
    connect: async () => undefined,
    db: () => fakeDatabase(),
    close: async () => undefined,
    ...overrides,
  }
}

function fakeDatabase(overrides: Partial<MongoDatabaseLikeForTest> = {}): MongoDatabaseLikeForTest {
  return {
    command: async () => ({ ok: 1 }),
    listCollections: () => fakeCursor([]).cursor,
    collection: () => ({
      find: () => fakeFindCursor([]).cursor,
      countDocuments: async () => 0,
      listIndexes: () => fakeCursor([]).cursor,
    }),
    ...overrides,
  }
}

function fakeCursor(entries: Record<string, unknown>[]) {
  let index = 0
  const close = vi.fn(async () => undefined)
  const cursor: MongoCursorLikeForTest = {
    next: async () => entries[index++] ?? null,
    close,
  }
  return { cursor, close }
}

function fakeFindCursor(entries: Record<string, unknown>[]) {
  const page = fakeCursor(entries)
  const sort = vi.fn()
  const skip = vi.fn()
  const limit = vi.fn()
  const cursor: MongoFindCursorLikeForTest = {
    ...page.cursor,
    sort: (value) => { sort(value); return cursor },
    skip: (value) => { skip(value); return cursor },
    limit: (value) => { limit(value); return cursor },
  }
  return { cursor, sort, skip, limit, close: page.close }
}

function source(overrides: Record<string, unknown> = {}): ResolvedDataSource {
  return {
    id: 'mongodb-source',
    projectId: 'project-1',
    publishedAgentId: null,
    kind: 'mongodb',
    label: 'MongoDB',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'custom',
      values: {
        host: 'mongo.example.com',
        user: 'integration',
        password: 'not-a-real-secret',
        database: 'app',
        ...overrides,
      },
    },
    status: 'active',
  }
}

function resolveLookup(lookup: LookupFunction): Promise<{ address: string; family: number }> {
  return new Promise((resolve, reject) => {
    lookup('mongo.example.com', {}, (error, address, family) => {
      if (error) reject(error)
      else resolve({ address: String(address), family: Number(family) })
    })
  })
}
