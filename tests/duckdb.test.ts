import { describe, expect, it } from 'vitest'
import { duckdbConnector } from '../src/connectors/adapters/duckdb.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/index.js'

describe('DuckDB connector', () => {
  it('ships the imported create-and-query action as a read-only executable spec', () => {
    expect(validateConnectorManifest(duckdbConnector.manifest)).toEqual({ ok: true, issues: [] })
    expect(duckdbConnector.manifest.capabilities).toMatchObject([
      { name: 'create.and.query.db', class: 'read' },
    ])
    expect(getIntegrationSpec('duckdb')).toMatchObject({ status: 'executable' })
  })

  it('joins real in-memory tables and binds dynamic values as parameters', async () => {
    const result = await duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: {
        tables: [
          { name: 'companies', data: [{ id: 1, name: 'Tangle' }, { id: 2, name: 'Webb' }] },
          { name: 'orders', data: [{ company_id: 1, amount: 42 }, { company_id: 1, amount: 8 }, { company_id: 2, amount: 20 }] },
        ],
        query: `
          SELECT companies.name, SUM(orders.amount) AS total
          FROM companies JOIN orders ON companies.id = orders.company_id
          WHERE orders.amount > $1
          GROUP BY companies.name
          ORDER BY total DESC
        `,
        args: [10],
      },
      idempotencyKey: 'duckdb-query-1',
    })
    expect(result.data).toMatchObject({
      rows: [{ name: 'Tangle', total: '42' }, { name: 'Webb', total: '20' }],
      rowCount: 2,
      truncated: false,
    })
  })

  it('caps returned rows and reports truncation', async () => {
    const result = await duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: {
        tables: [{ name: 'items', data: [{ id: 1 }, { id: 2 }, { id: 3 }] }],
        query: 'SELECT * FROM items ORDER BY id',
        maxRows: 2,
      },
      idempotencyKey: 'duckdb-query-2',
    })
    expect(result.data).toMatchObject({ rows: [{ id: '1' }, { id: '2' }], rowCount: 2, truncated: true })
  })

  it('uses an explicit schema to create an empty table', async () => {
    const result = await duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: {
        tables: [{ name: 'empty_items', data: [], schema: { id: 'BIGINT', name: 'VARCHAR' } }],
        query: 'SELECT COUNT(*) AS count FROM empty_items',
      },
      idempotencyKey: 'duckdb-empty-schema',
    })
    expect(result.data).toMatchObject({ rows: [{ count: '0' }], rowCount: 1, truncated: false })
  })

  it('rejects identifier injection and duplicate table names before opening SQL', async () => {
    await expect(duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: { tables: [{ name: 'items; DROP TABLE items', data: [] }], query: 'SELECT 1' },
      idempotencyKey: 'duckdb-invalid-1',
    })).rejects.toThrow(/safe SQL identifier/)

    await expect(duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: {
        tables: [{ name: 'Items', data: [{ id: 1 }] }, { name: 'items', data: [{ id: 2 }] }],
        query: 'SELECT 1',
      },
      idempotencyKey: 'duckdb-invalid-2',
    })).rejects.toThrow(/unique ignoring case/)
  })

  it('rejects nested schemas that expand beyond the column limit', async () => {
    const nestedSchema = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`field_${index}`, 'VARCHAR']))
    await expect(duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: {
        tables: [{ name: 'items', data: [], schema: { nested: nestedSchema } }],
        query: 'SELECT * FROM items',
      },
      idempotencyKey: 'duckdb-schema-limit',
    })).rejects.toThrow(/exceeds 256 leaf columns/)
  })

  it('blocks external file reads and user-supplied write statements', async () => {
    await expect(duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: {
        tables: [{ name: 'items', data: [{ id: 1 }] }],
        query: "SELECT * FROM read_csv_auto('/etc/passwd')",
      },
      idempotencyKey: 'duckdb-external-read',
    })).rejects.toThrow(/external access|disabled/i)

    await expect(duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: {
        tables: [{ name: 'items', data: [{ id: 1 }] }],
        query: 'DELETE FROM items',
      },
      idempotencyKey: 'duckdb-write',
    })).rejects.toThrow()
  })

  it('locks external access, memory, and thread settings before running user SQL', async () => {
    const result = await duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: {
        tables: [{ name: 'items', data: [{ id: 1 }] }],
        query: `
          SELECT
            current_setting('enable_external_access') AS external_access,
            current_setting('lock_configuration') AS locked,
            current_setting('memory_limit') AS memory_limit,
            current_setting('threads') AS threads
        `,
      },
      idempotencyKey: 'duckdb-settings',
    })
    expect(result.data).toMatchObject({
      rows: [{ external_access: false, locked: true, memory_limit: '244.1 MiB', threads: '2' }],
    })
  })

  it('rejects query output larger than the ten-megabyte response limit', async () => {
    await expect(duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: {
        tables: [{ name: 'items', data: [{ id: 1 }] }],
        query: `SELECT repeat('x', ${10 * 1024 * 1024 + 1}) AS payload`,
      },
      idempotencyKey: 'duckdb-output-limit',
    })).rejects.toThrow(/output limit/)
  })

  it('interrupts a query that exceeds the five-second execution limit', async () => {
    await expect(duckdbConnector.executeRead!({
      source: source(),
      capabilityName: 'create.and.query.db',
      args: {
        tables: [{ name: 'items', data: [{ id: 1 }] }],
        query: 'SELECT SUM(sin(i)) AS total FROM range(1000000000000) AS values(i)',
      },
      idempotencyKey: 'duckdb-time-limit',
    })).rejects.toThrow(/exceeded 5000ms/)
  }, 10_000)

  it('runs the native in-memory connection check', async () => {
    await expect(duckdbConnector.test!(source())).resolves.toEqual({ ok: true })
  })
})

function source(): ResolvedDataSource {
  return {
    id: 'src_duckdb_1',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'duckdb',
    label: 'DuckDB test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: { kind: 'none' },
    status: 'active',
  }
}
