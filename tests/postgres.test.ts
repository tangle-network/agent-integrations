import type { ClientConfig, FieldDef, QueryConfig } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { CONNECTOR_ADAPTER_FACTORIES } from '../src/connectors/adapters/factories.js'
import {
  createPostgresConnector,
  postgresConnector,
  type PostgresConnectorOptions,
} from '../src/connectors/adapters/postgres.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/index.js'

describe('PostgreSQL connector', () => {
  it('replaces the REST placeholder with a valid authoritative read-only wire surface', () => {
    expect(validateConnectorManifest(postgresConnector.manifest)).toEqual({ ok: true, issues: [] })
    expect(postgresConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'postgres.schemas.list',
      'postgres.tables.list',
      'postgres.tables.describe',
      'postgres.rows.select',
    ])
    expect(postgresConnector.manifest.capabilities.every((capability) => capability.class === 'read')).toBe(true)
  })

  it('exposes executable structured-secret setup and a no-shared-secret factory', () => {
    expect(getIntegrationSpec('postgres')).toMatchObject({
      status: 'executable',
      setup: { credentialFields: [{ label: 'PostgreSQL connection JSON', secret: true }] },
    })
    const factory = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === 'postgres')
    expect(factory?.envMap).toEqual({})
    expect(factory?.factory({}).manifest.kind).toBe('postgres')
  })

  it('uses PostgreSQL defaults while pinning the public address and TLS server name', async () => {
    let config: ClientConfig | undefined
    const connector = createPostgresConnector({
      resolveHost: async () => ['203.0.113.10'],
      createClient: (nextConfig) => {
        config = nextConfig
        return fakeClient()
      },
    })
    await expect(connector.test(source())).resolves.toEqual({ ok: true })
    expect(config).toMatchObject({
      host: '203.0.113.10',
      port: 5432,
      user: 'integration',
      database: 'app',
      ssl: {
        servername: 'postgres.example.com',
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      },
    })
  })

  it('runs a quoted parameterized row read and always rolls back', async () => {
    const queries: QueryConfig[] = []
    const connector = connectorWith(fakeClient({
      query: async (query) => {
        queries.push(query)
        return query.text.startsWith('SELECT')
          ? result([{ id: '42', state: 'active' }], [field('id'), field('state')])
          : result([])
      },
    }))
    const response = await connector.executeRead!({
      source: source(),
      capabilityName: 'postgres.rows.select',
      args: {
        schema: 'public',
        table: 'accounts',
        columns: ['id', 'state'],
        filters: [{ column: 'state', operator: 'eq', value: 'active' }],
        limit: 10,
      },
      idempotencyKey: 'postgres-select-1',
    })
    expect(queries.map((query) => query.text)).toEqual([
      'BEGIN READ ONLY',
      'SELECT "id", "state" FROM "public"."accounts" WHERE "state" = $1 LIMIT 10 OFFSET 0',
      'ROLLBACK',
    ])
    expect(queries[1]?.values).toEqual(['active'])
    expect(response.data).toMatchObject({ rows: [{ id: '42', state: 'active' }], rowCount: 1 })
  })

  it('bounds metadata queries at the server before receiving provider rows', async () => {
    const queries: QueryConfig[] = []
    const connector = connectorWith(fakeClient({
      query: async (query) => {
        queries.push(query)
        return result([])
      },
    }))
    for (const [capabilityName, args] of [
      ['postgres.schemas.list', {}],
      ['postgres.tables.list', { schema: 'public' }],
      ['postgres.tables.describe', { schema: 'public', table: 'accounts' }],
    ] as const) {
      await connector.executeRead!({
        source: source(),
        capabilityName,
        args,
        idempotencyKey: `postgres-bounded-${capabilityName}`,
      })
    }
    const metadataQueries = queries.filter((query) => query.text.startsWith('SELECT'))
    expect(metadataQueries).toHaveLength(3)
    expect(metadataQueries.every((query) => query.text.endsWith('LIMIT 10001'))).toBe(true)
  })

  it('rejects injection and private targets before constructing a client', async () => {
    const resolveHost = vi.fn(async () => ['203.0.113.10'])
    const createClient = vi.fn(() => fakeClient())
    const connector = createPostgresConnector({ resolveHost, createClient })
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'postgres.rows.select',
      args: { table: 'accounts', columns: ['id', 'pg_sleep(10)'] },
      idempotencyKey: 'postgres-injection',
    })).rejects.toThrow('columns[1] must be a SQL identifier')
    await expect(connector.test(source({ host: '127.0.0.1' }))).resolves.toMatchObject({ ok: false })
    expect(resolveHost).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('redacts the password from driver failures', async () => {
    const connector = createPostgresConnector({
      resolveHost: async () => ['203.0.113.10'],
      createClient: () => fakeClient({ connect: async () => { throw new Error('login failed for not-a-real-secret') } }),
    })
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'postgres.schemas.list',
      args: {},
      idempotencyKey: 'postgres-redact',
    })).rejects.toThrow('login failed for [REDACTED]')
  })
})

type PostgresClientLikeForTest = ReturnType<NonNullable<PostgresConnectorOptions['createClient']>>

function connectorWith(client: PostgresClientLikeForTest) {
  return createPostgresConnector({
    resolveHost: async () => ['203.0.113.10'],
    createClient: () => client,
  })
}

function fakeClient(overrides: Partial<PostgresClientLikeForTest> = {}): PostgresClientLikeForTest {
  return {
    on() { return this },
    connect: async () => undefined,
    query: async () => result([]),
    end: async () => undefined,
    ...overrides,
  }
}

function result(rows: unknown[], fields: FieldDef[] = []) {
  return { rows, fields, rowCount: rows.length }
}

function field(name: string): FieldDef {
  return { name, tableID: 1, columnID: 1, dataTypeID: 25, dataTypeSize: -1, dataTypeModifier: -1, format: 'text' }
}

function source(overrides: Record<string, unknown> = {}): ResolvedDataSource {
  return {
    id: 'postgres-source',
    projectId: 'project-1',
    publishedAgentId: null,
    kind: 'postgres',
    label: 'PostgreSQL',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'custom',
      values: {
        host: 'postgres.example.com',
        user: 'integration',
        password: 'not-a-real-secret',
        database: 'app',
        ...overrides,
      },
    },
    status: 'active',
  }
}
