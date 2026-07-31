import type { ClientConfig, FieldDef, QueryConfig } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { CONNECTOR_ADAPTER_FACTORIES } from '../src/connectors/adapters/factories.js'
import {
  createRedshiftConnector,
  redshiftConnector,
  type RedshiftConnectorOptions,
} from '../src/connectors/adapters/redshift.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/index.js'

describe('Redshift connector', () => {
  it('ships a valid authoritative read-only warehouse surface', () => {
    expect(validateConnectorManifest(redshiftConnector.manifest)).toEqual({ ok: true, issues: [] })
    expect(redshiftConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'redshift.schemas.list',
      'redshift.tables.list',
      'redshift.tables.describe',
      'redshift.rows.select',
    ])
    expect(redshiftConnector.manifest.capabilities.every((capability) => capability.class === 'read')).toBe(true)
  })

  it('exposes executable structured-secret setup and a no-shared-secret factory', () => {
    expect(getIntegrationSpec('redshift')).toMatchObject({
      status: 'executable',
      setup: { credentialFields: [{ label: 'Redshift connection JSON', secret: true }] },
    })
    const factory = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === 'redshift')
    expect(factory?.envMap).toEqual({})
    expect(factory?.factory({}).manifest.kind).toBe('redshift')
  })

  it('pins a public address while retaining the DNS name for verified TLS identity', async () => {
    let config: ClientConfig | undefined
    const connector = createRedshiftConnector({
      resolveHost: async () => ['203.0.113.10'],
      createClient: (nextConfig) => {
        config = nextConfig
        return fakeClient()
      },
    })
    await expect(connector.test(source())).resolves.toEqual({ ok: true })
    expect(config).toMatchObject({
      host: '203.0.113.10',
      port: 5439,
      user: 'integration',
      database: 'analytics',
      application_name: 'tangle-integration-hub',
      ssl: {
        servername: 'warehouse.example.com',
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      },
    })
  })

  it('builds identifier-safe parameterized row reads inside a read-only transaction', async () => {
    const queries: QueryConfig[] = []
    const connector = connectorWith(fakeClient({
      query: async (query) => {
        queries.push(query)
        if (query.text.startsWith('SELECT')) {
          return result([{ id: '42', stage: 'won' }], [field('id'), field('stage')])
        }
        return result([])
      },
    }))
    const response = await connector.executeRead!({
      source: source(),
      capabilityName: 'redshift.rows.select',
      args: {
        schema: 'crm',
        table: 'deals',
        columns: ['id', 'stage'],
        filters: [
          { column: 'stage', operator: 'eq', value: 'won' },
          { column: 'deleted_at', operator: 'is-null' },
        ],
        orderBy: [{ column: 'id', direction: 'desc' }],
        limit: 25,
        offset: 50,
      },
      idempotencyKey: 'redshift-select-1',
    })
    expect(queries.map((query) => query.text)).toEqual([
      'BEGIN READ ONLY',
      'SELECT "id", "stage" FROM "crm"."deals" WHERE "stage" = $1 AND "deleted_at" IS NULL ORDER BY "id" DESC LIMIT 25 OFFSET 50',
      'ROLLBACK',
    ])
    expect(queries[1]?.values).toEqual(['won'])
    expect(response.data).toMatchObject({ rows: [{ id: '42', stage: 'won' }], rowCount: 1 })
  })

  it('rolls back the read-only transaction when the provider query fails', async () => {
    const calls: string[] = []
    const connector = connectorWith(fakeClient({
      query: async (query) => {
        calls.push(query.text)
        if (query.text.startsWith('SELECT')) throw new Error('statement timed out')
        return result([])
      },
    }))
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'redshift.rows.select',
      args: { table: 'deals', columns: ['id'] },
      idempotencyKey: 'redshift-timeout',
    })).rejects.toThrow('statement timed out')
    expect(calls).toEqual(['BEGIN READ ONLY', 'SELECT "id" FROM "public"."deals" LIMIT 100 OFFSET 0', 'ROLLBACK'])
  })

  it('rejects identifier injection and malformed filters before resolving or connecting', async () => {
    const resolveHost = vi.fn(async () => ['203.0.113.10'])
    const createClient = vi.fn(() => fakeClient())
    const connector = createRedshiftConnector({ resolveHost, createClient })
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'redshift.rows.select',
      args: { table: 'deals; DROP TABLE users', columns: ['id'] },
      idempotencyKey: 'redshift-injection',
    })).rejects.toThrow('table must be a SQL identifier')
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'redshift.rows.select',
      args: { table: 'deals', columns: ['id'], filters: [{ column: 'id', operator: 'like', value: 42 }] },
      idempotencyKey: 'redshift-bad-filter',
    })).rejects.toThrow('must be a string for like')
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'redshift.rows.select',
      args: { table: 'deals', columns: ['id'], filters: [{ column: 'deleted_at', operator: 'eq', value: null }] },
      idempotencyKey: 'redshift-null-filter',
    })).rejects.toThrow('must use is-null or not-null')
    expect(resolveHost).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('rejects private targets and redacts passwords from driver failures', async () => {
    const createClient = vi.fn(() => fakeClient())
    const connector = createRedshiftConnector({ createClient })
    await expect(connector.test(source({ host: '127.0.0.1' }))).resolves.toMatchObject({ ok: false })
    expect(createClient).not.toHaveBeenCalled()

    const failing = createRedshiftConnector({
      resolveHost: async () => ['203.0.113.10'],
      createClient: () => fakeClient({ connect: async () => { throw new Error('login failed for not-a-real-secret') } }),
    })
    await expect(failing.executeRead!({
      source: source(),
      capabilityName: 'redshift.schemas.list',
      args: {},
      idempotencyKey: 'redshift-redact',
    })).rejects.toThrow('login failed for [REDACTED]')
  })

  it('rejects oversized provider results and malformed credential JSON', async () => {
    const connector = connectorWith(fakeClient({
      query: async (query) => query.text.startsWith('SELECT')
        ? result(Array.from({ length: 10_001 }, (_, index) => ({ index })))
        : result([]),
    }))
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'redshift.rows.select',
      args: { table: 'deals', columns: ['id'], limit: 10_000 },
      idempotencyKey: 'redshift-large-result',
    })).rejects.toThrow('exceeds 10000 rows')

    const malformed = source()
    malformed.credentials = { kind: 'api-key', apiKey: '{not-json' }
    await expect(connector.executeRead!({
      source: malformed,
      capabilityName: 'redshift.schemas.list',
      args: {},
      idempotencyKey: 'redshift-malformed',
    })).rejects.toThrow('Redshift credential must be valid JSON')
  })
})

type RedshiftClientLikeForTest = ReturnType<NonNullable<RedshiftConnectorOptions['createClient']>>

function connectorWith(client: RedshiftClientLikeForTest) {
  return createRedshiftConnector({
    resolveHost: async () => ['203.0.113.10'],
    createClient: () => client,
  })
}

function fakeClient(overrides: Partial<RedshiftClientLikeForTest> = {}): RedshiftClientLikeForTest {
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
    id: 'redshift-source',
    projectId: 'project-1',
    publishedAgentId: null,
    kind: 'redshift',
    label: 'Redshift',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'custom',
      values: {
        host: 'warehouse.example.com',
        port: 5439,
        user: 'integration',
        password: 'not-a-real-secret',
        database: 'analytics',
        ...overrides,
      },
    },
    status: 'active',
  }
}
