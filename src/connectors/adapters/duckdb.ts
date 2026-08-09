import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api'
import type { ConnectorAdapter } from '../types.js'
import { isPlainRecord, readBoundedInteger } from './file-payload.js'

/**
 * `@duckdb/node-api` is a NATIVE Node addon, and a static import of this module
 * is what a consumer's bundler must resolve — including the ones that only read
 * this connector's static manifest through `/catalog` or `/specs`. A Worker
 * cannot load a `.node` file at all, so the bundle failed with
 * `UNLOADABLE_DEPENDENCY … duckdb.node` on a build that never intended to run a
 * query. The client is loaded when a query actually runs, so the manifest costs
 * nothing to read. The TYPES stay static — they erase.
 */
async function duckdbInstance(): Promise<typeof import('@duckdb/node-api').DuckDBInstance> {
  // The specifier is assembled at runtime ON PURPOSE. A bundler resolves a
  // LITERAL `await import('@duckdb/node-api')` exactly like a static one — it
  // moves the module to its own chunk and still has to load `duckdb.node`,
  // which a Worker build cannot do. A specifier it cannot read statically is
  // left to the runtime, so Node resolves it and a Worker bundle never sees it.
  const specifier = ['@duckdb', 'node-api'].join('/')
  const { DuckDBInstance } = (await import(specifier)) as typeof import('@duckdb/node-api')
  return DuckDBInstance
}

const MAX_ARGUMENTS = 100
const MAX_COLUMNS = 256
const MAX_EXECUTION_MS = 5_000
const MAX_INPUT_BYTES = 10 * 1024 * 1024
const MAX_QUERY_BYTES = 20_000
const MAX_RESULT_BYTES = 10 * 1024 * 1024
const MAX_ROWS = 10_000
const MAX_SCHEMA_DEPTH = 16
const MAX_TABLES = 16
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/

interface InputTable {
  name: string
  data: Record<string, unknown>[]
  schema?: Record<string, unknown>
}

export const duckdbConnector: ConnectorAdapter = {
  manifest: {
    kind: 'duckdb',
    displayName: 'DuckDB',
    description: 'Load bounded JSON tables into a throwaway in-memory DuckDB database and run a parameterized query.',
    auth: { kind: 'none' },
    defaultConsistencyModel: 'advisory',
    category: 'database',
    capabilities: [
      {
        name: 'create.and.query.db',
        class: 'read',
        description: 'Create in-memory tables from JSON arrays and return a bounded parameterized SQL query result.',
        parameters: {
          type: 'object',
          properties: {
            tables: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_TABLES,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', pattern: TABLE_NAME.source, maxLength: 63 },
                  data: { type: 'array', maxItems: MAX_ROWS, items: { type: 'object' } },
                  schema: { type: 'object', maxProperties: MAX_COLUMNS },
                },
                required: ['name', 'data'],
                additionalProperties: false,
              },
            },
            query: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_QUERY_BYTES,
              description: 'A single relation-returning SQL query. Use $1, $2, and args for dynamic values.',
            },
            args: {
              type: 'array',
              maxItems: MAX_ARGUMENTS,
              items: { type: ['string', 'number', 'boolean', 'null'] },
            },
            maxRows: { type: 'integer', minimum: 1, maximum: MAX_ROWS, default: 1_000 },
          },
          required: ['tables', 'query'],
          additionalProperties: false,
        },
      },
    ],
  },

  async executeRead({ capabilityName, args }) {
    if (capabilityName !== 'create.and.query.db') {
      throw new Error(`Unknown DuckDB capability: ${capabilityName}`)
    }
    const tables = readTables(args.tables)
    const query = readQuery(args.query)
    const queryArgs = readArguments(args.args)
    const maxRows = readBoundedInteger(args.maxRows, 1_000, 1, MAX_ROWS, 'maxRows')

    const instance = await (await duckdbInstance()).create(':memory:')
    let connection: DuckDBConnection | undefined
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    try {
      const activeConnection = await instance.connect()
      connection = activeConnection
      timeout = setTimeout(() => {
        timedOut = true
        activeConnection.interrupt()
      }, MAX_EXECUTION_MS)
      await configureConnection(activeConnection)
      throwIfTimedOut(timedOut)
      for (const table of tables) {
        await loadTable(activeConnection, table)
        throwIfTimedOut(timedOut)
      }

      const reader = await activeConnection.runAndReadAll(
        `SELECT * FROM (${query}) AS "_tangle_result" LIMIT ${maxRows + 1}`,
        queryArgs,
      )
      throwIfTimedOut(timedOut)
      const allRows = reader.getRowObjectsJson()
      const truncated = allRows.length > maxRows
      const rows = truncated ? allRows.slice(0, maxRows) : allRows
      assertResultSize(rows)
      return {
        data: {
          rows,
          rowCount: rows.length,
          truncated,
          columns: reader.columnNameAndTypeObjectsJson(),
        },
        fetchedAt: Date.now(),
      }
    } catch (error) {
      if (timedOut) throw new Error(`DuckDB execution exceeded ${MAX_EXECUTION_MS}ms`)
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
      try {
        connection?.closeSync()
      } finally {
        instance.closeSync()
      }
    }
  },

  async test() {
    const instance = await (await duckdbInstance()).create(':memory:')
    let connection: DuckDBConnection | undefined
    try {
      const activeConnection = await instance.connect()
      connection = activeConnection
      await configureConnection(activeConnection)
      const reader = await activeConnection.runAndReadAll('SELECT 1 AS ok')
      if (reader.getRowObjectsJson()[0]?.ok !== 1) return { ok: false, reason: 'DuckDB SELECT 1 returned an unexpected result' }
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    } finally {
      try {
        connection?.closeSync()
      } finally {
        instance.closeSync()
      }
    }
  },
}

async function configureConnection(connection: DuckDBConnection): Promise<void> {
  await connection.run(`
    SET memory_limit = '256MB';
    SET max_temp_directory_size = '0B';
    SET threads = 2;
    SET enable_logging = false;
    SET enable_external_access = false;
    SET lock_configuration = true;
  `)
}

async function loadTable(connection: DuckDBConnection, table: InputTable): Promise<void> {
  const sourceData = stringifyJson(table.data, `${table.name}.data`)
  let sourceSchema: string
  if (table.schema) {
    assertDuckDbSchema(table.schema, `${table.name}.schema`)
    sourceSchema = stringifyJson([table.schema], `${table.name}.schema`)
  } else {
    if (table.data.length === 0) {
      throw new Error(`${table.name}.schema is required when data is empty`)
    }
    const detected = await connection.runAndReadAll(
      'SELECT json_structure($sourceData) AS schema',
      { sourceData },
    )
    const value = detected.getRowsJson()[0]?.[0]
    if (typeof value !== 'string') throw new Error(`Could not infer a schema for ${table.name}`)
    let detectedSchema: unknown
    try {
      detectedSchema = JSON.parse(value)
    } catch {
      throw new Error(`Could not parse the inferred schema for ${table.name}`)
    }
    assertDuckDbSchema(detectedSchema, `${table.name}.inferredSchema`)
    sourceSchema = value
  }

  await connection.run(
    `CREATE TABLE ${quoteIdentifier(table.name)} AS
       SELECT UNNEST(JSON_TRANSFORM($sourceData, $sourceSchema), recursive := true)`,
    { sourceData, sourceSchema },
  )
}

function readTables(value: unknown): InputTable[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TABLES) {
    throw new Error(`tables must contain 1 through ${MAX_TABLES} entries`)
  }
  assertInputSize(value)
  let totalRows = 0
  const tables = value.map((entry, tableIndex) => {
    if (!isPlainRecord(entry)) throw new Error(`tables[${tableIndex}] must be an object`)
    const { name, data, schema } = entry
    if (typeof name !== 'string' || !TABLE_NAME.test(name)) {
      throw new Error(`tables[${tableIndex}].name must be a safe SQL identifier`)
    }
    if (!Array.isArray(data) || data.length > MAX_ROWS) {
      throw new Error(`tables[${tableIndex}].data must contain at most ${MAX_ROWS} rows`)
    }
    const records = data.map((record, rowIndex) => {
      if (!isPlainRecord(record)) throw new Error(`tables[${tableIndex}].data[${rowIndex}] must be an object`)
      if (Object.keys(record).length > MAX_COLUMNS) {
        throw new Error(`tables[${tableIndex}].data[${rowIndex}] exceeds ${MAX_COLUMNS} columns`)
      }
      return record
    })
    const columns = new Set(records.flatMap((record) => Object.keys(record)))
    if (columns.size > MAX_COLUMNS) {
      throw new Error(`tables[${tableIndex}].data exceeds ${MAX_COLUMNS} distinct columns`)
    }
    totalRows += records.length
    if (totalRows > MAX_ROWS) throw new Error(`tables exceed the ${MAX_ROWS}-row total limit`)
    if (schema !== undefined && (!isPlainRecord(schema) || Object.keys(schema).length > MAX_COLUMNS)) {
      throw new Error(`tables[${tableIndex}].schema must contain at most ${MAX_COLUMNS} fields`)
    }
    return { name, data: records, schema: schema as Record<string, unknown> | undefined }
  })
  if (new Set(tables.map((table) => table.name.toLowerCase())).size !== tables.length) {
    throw new Error('table names must be unique ignoring case')
  }
  return tables
}

function readQuery(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('query is required')
  if (Buffer.byteLength(value, 'utf8') > MAX_QUERY_BYTES) {
    throw new Error(`query exceeds the ${MAX_QUERY_BYTES}-byte limit`)
  }
  return value.trim().replace(/;\s*$/, '')
}

function readArguments(value: unknown): Record<string, DuckDBValue> {
  if (value === undefined || value === null) return {}
  if (!Array.isArray(value) || value.length > MAX_ARGUMENTS) {
    throw new Error(`args must contain at most ${MAX_ARGUMENTS} scalar values`)
  }
  return Object.fromEntries(value.map((entry, index) => {
    if (entry !== null && typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean') {
      throw new Error(`args[${index}] must be a string, number, boolean, or null`)
    }
    if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error(`args[${index}] must be finite`)
    return [String(index + 1), entry]
  }))
}

function assertInputSize(value: unknown): void {
  const serialized = stringifyJson(value, 'tables')
  if (Buffer.byteLength(serialized, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error(`tables exceed the ${MAX_INPUT_BYTES}-byte input limit`)
  }
}

function assertResultSize(rows: unknown[]): void {
  const serialized = stringifyJson(rows, 'DuckDB result')
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) {
    throw new Error(`DuckDB result exceeds the ${MAX_RESULT_BYTES}-byte output limit`)
  }
}

function assertDuckDbSchema(value: unknown, label: string): void {
  let leaves = 0
  const visit = (entry: unknown, depth: number): void => {
    if (depth > MAX_SCHEMA_DEPTH) throw new Error(`${label} exceeds ${MAX_SCHEMA_DEPTH} nested levels`)
    if (typeof entry === 'string') {
      leaves += 1
      if (leaves > MAX_COLUMNS) throw new Error(`${label} exceeds ${MAX_COLUMNS} leaf columns`)
      return
    }
    if (Array.isArray(entry)) {
      if (entry.length !== 1) throw new Error(`${label} array schemas must contain exactly one element type`)
      visit(entry[0], depth + 1)
      return
    }
    if (!isPlainRecord(entry) || Object.keys(entry).length === 0) {
      throw new Error(`${label} must describe at least one DuckDB column type`)
    }
    for (const child of Object.values(entry)) visit(child, depth + 1)
  }
  visit(value, 0)
}

function stringifyJson(value: unknown, label: string): string {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('undefined')
    return serialized
  } catch {
    throw new Error(`${label} must be JSON-serializable`)
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function throwIfTimedOut(timedOut: boolean): void {
  if (timedOut) throw new Error(`DuckDB execution exceeded ${MAX_EXECUTION_MS}ms`)
}
