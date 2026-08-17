import type { ConnectionOptions, FieldPacket } from 'mysql2/promise'
import { describe, expect, it, vi } from 'vitest'
import {
  createMySqlConnector,
  mysqlConnector,
  type MySqlConnectorOptions,
} from '../src/connectors/adapters/mysql.js'
import { CONNECTOR_ADAPTER_FACTORIES } from '../src/connectors/adapters/factories.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/index.js'

describe('MySQL connector', () => {
  it('ships a valid authoritative manifest with approval-gated compare-and-swap writes', () => {
    expect(validateConnectorManifest(mysqlConnector.manifest)).toEqual({ ok: true, issues: [] })
    expect(mysqlConnector.manifest.category).toBe('database')
    expect(mysqlConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(mysqlConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'mysql.databases.list',
      'mysql.tables.list',
      'mysql.tables.describe',
      'mysql.query',
      'mysql.execute',
    ])
    const mutation = mysqlConnector.manifest.capabilities.find((capability) => capability.class === 'mutation')
    expect(mutation).toMatchObject({ cas: 'optimistic-read-verify', externalEffect: true })
  })

  it('exposes executable API-key setup and a no-shared-secret factory', () => {
    expect(getIntegrationSpec('mysql')).toMatchObject({ status: 'executable', auth: { mode: 'api_key' } })
    const factory = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === 'mysql')
    expect(factory?.envMap).toEqual({})
    expect(factory?.factory({}).manifest.kind).toBe('mysql')
  })

  it('uses a pinned public address while retaining the hostname for verified TLS identity', async () => {
    let config: ConnectionOptions | undefined
    const connector = createMySqlConnector({
      resolveHost: async () => ['203.0.113.10'],
      createConnection: async (value) => {
        config = value
        return fakeConnection()
      },
    })
    await expect(connector.test(source())).resolves.toEqual({ ok: true })
    expect(config).toMatchObject({
      host: 'mysql.example.com',
      port: 3306,
      user: 'integration',
      multipleStatements: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        verifyIdentity: true,
      },
    })
    expect(config?.stream).toBeDefined()
  })

  it('runs reads inside a read-only transaction and always rolls it back', async () => {
    const calls: string[] = []
    const connection = fakeConnection({
      execute: async (options) => {
        calls.push(options.sql)
        if (options.sql === 'START TRANSACTION READ ONLY') return [{ affectedRows: 0 }, []]
        return [[{ id: '9007199254740993' }], [{ name: 'id', table: 'deals', schema: 'crm', type: 8 } as FieldPacket]]
      },
      rollback: async () => { calls.push('ROLLBACK') },
    })
    const connector = connectorWith(connection)
    const result = await connector.executeRead!({
      source: source(),
      capabilityName: 'mysql.query',
      args: { statement: 'SELECT id FROM deals WHERE stage = ?', parameters: ['signed'] },
      idempotencyKey: 'mysql-read-1',
    })
    expect(result.data).toEqual({
      rows: [{ id: '9007199254740993' }],
      columns: [{ name: 'id', table: 'deals', database: 'crm', type: 8 }],
      rowCount: 1,
    })
    expect(calls).toEqual([
      'START TRANSACTION READ ONLY',
      'SELECT id FROM deals WHERE stage = ?',
      'ROLLBACK',
    ])
  })

  it.each([
    'UPDATE deals SET stage = "won"',
    'SELECT * FROM deals INTO OUTFILE "/tmp/deals"',
    'SELECT SLEEP(10)',
    'SELECT * FROM deals FOR UPDATE',
  ])('rejects unsafe read statement before opening a connection: %s', async (statement) => {
    const createConnection = vi.fn(async () => fakeConnection())
    const connector = createMySqlConnector({
      resolveHost: async () => ['203.0.113.10'],
      createConnection,
    })
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'mysql.query',
      args: { statement },
      idempotencyKey: 'mysql-unsafe-read',
    })).rejects.toThrow()
    expect(createConnection).not.toHaveBeenCalled()
  })

  it('commits an approved mutation only when its affected-row expectation matches', async () => {
    const calls: string[] = []
    const connector = connectorWith(fakeConnection({
      beginTransaction: async () => { calls.push('BEGIN') },
      execute: async (options) => {
        calls.push(options.sql)
        return [{ affectedRows: 1, changedRows: 1, insertId: 0, warningStatus: 0 }, []]
      },
      commit: async () => { calls.push('COMMIT') },
      rollback: async () => { calls.push('ROLLBACK') },
    }))
    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'mysql.execute',
      args: {
        statement: 'UPDATE deals SET stage = ? WHERE id = ? AND stage = ?',
        parameters: ['won', 42, 'contract'],
        expectedAffectedRows: 1,
      },
      idempotencyKey: 'mysql-write-1',
    })
    expect(result).toMatchObject({ status: 'committed', data: { affectedRows: 1 } })
    expect(calls).toEqual([
      'BEGIN',
      'UPDATE deals SET stage = ? WHERE id = ? AND stage = ?',
      'COMMIT',
    ])
  })

  it('rolls back and reports a conflict when affected rows differ', async () => {
    const calls: string[] = []
    const connector = connectorWith(fakeConnection({
      execute: async () => [{ affectedRows: 0 }, []],
      rollback: async () => { calls.push('ROLLBACK') },
    }))
    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'mysql.execute',
      args: {
        statement: 'DELETE FROM deals WHERE id = ? AND stage = ?',
        parameters: [42, 'draft'],
        expectedAffectedRows: 1,
      },
      idempotencyKey: 'mysql-write-conflict',
    })
    expect(result).toMatchObject({
      status: 'conflict',
      currentState: { affectedRows: 0 },
    })
    expect(calls).toEqual(['ROLLBACK'])
  })

  it('rejects DDL writes and private hosts before constructing a driver connection', async () => {
    const createConnection = vi.fn(async () => fakeConnection())
    const connector = createMySqlConnector({ createConnection })
    await expect(connector.executeMutation!({
      source: source(),
      capabilityName: 'mysql.execute',
      args: { statement: 'DROP TABLE deals', expectedAffectedRows: 0 },
      idempotencyKey: 'mysql-ddl',
    })).rejects.toThrow(/accepts only/)
    await expect(connector.test(source({ host: '127.0.0.1' }))).resolves.toMatchObject({ ok: false })
    expect(createConnection).not.toHaveBeenCalled()
  })
})

function connectorWith(connection: MySqlConnectionLikeForTest) {
  return createMySqlConnector({
    resolveHost: async () => ['203.0.113.10'],
    createConnection: async () => connection,
  })
}

type MySqlConnectionLikeForTest = Awaited<ReturnType<NonNullable<MySqlConnectorOptions['createConnection']>>>

function fakeConnection(overrides: Partial<MySqlConnectionLikeForTest> = {}): MySqlConnectionLikeForTest {
  return {
    execute: async () => [[], []],
    ping: async () => undefined,
    beginTransaction: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    end: async () => undefined,
    ...overrides,
  }
}

function source(overrides: Record<string, unknown> = {}): ResolvedDataSource {
  return {
    id: 'mysql-source',
    projectId: 'project-1',
    publishedAgentId: null,
    kind: 'mysql',
    label: 'MySQL',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'custom',
      values: {
        host: 'mysql.example.com',
        port: 3306,
        user: 'integration',
        password: 'not-a-real-secret',
        database: 'crm',
        ...overrides,
      },
    },
    status: 'active',
  }
}
