import { connect as createSocket, isIP } from 'node:net'
import {
  createConnection as createMysqlConnection,
  type ConnectionOptions,
  type FieldPacket,
  type ResultSetHeader,
} from 'mysql2/promise'
import type {
  CapabilityMutationResult,
  ConnectorAdapter,
  ConnectorInvocation,
  ResolvedDataSource,
} from '../types.js'
import {
  isPlainRecord,
  jsonSafe,
  readBoundedInteger,
  readOptionalString,
} from './file-payload.js'
import { resolvePublicHostAddresses } from './public-network.js'

const MAX_PARAMETERS = 1_000
const MAX_PARAMETER_BYTES = 10 * 1024 * 1024
const MAX_RESULT_ROWS = 10_000
const MAX_RESULT_BYTES = 10 * 1024 * 1024
const DEFAULT_QUERY_TIMEOUT_MS = 30_000

interface MySqlConnectionLike {
  execute(options: { sql: string; values?: unknown[]; timeout: number }): Promise<[unknown, FieldPacket[]]>
  ping(): Promise<void>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  end(): Promise<void>
}

export interface MySqlConnectorOptions {
  createConnection?: (config: ConnectionOptions) => Promise<MySqlConnectionLike>
  resolveHost?: (host: string) => Promise<string[]>
}

interface MySqlCredentials {
  host: string
  port: number
  user: string
  password: string
  database?: string
  tlsCa?: string
  connectTimeoutMs: number
  queryTimeoutMs: number
}

interface QueryInput {
  statement: string
  parameters: unknown[]
}

export function createMySqlConnector(options: MySqlConnectorOptions = {}): ConnectorAdapter {
  const createConnection = options.createConnection ?? defaultCreateConnection
  const resolveHost = options.resolveHost ?? resolvePublicHostAddresses

  return {
    manifest: {
      kind: 'mysql',
      displayName: 'MySQL',
      description: 'Inspect schemas and run bounded parameterized reads or approved compare-and-swap writes against MySQL over verified TLS.',
      auth: {
        kind: 'api-key',
        hint: 'JSON with host, port, user, password, optional database, and optional tlsCa. TLS and public network targets are mandatory.',
      },
      defaultConsistencyModel: 'authoritative',
      category: 'database',
      rateLimit: { requests: 120, windowMs: 60_000, scope: 'data-source' },
      capabilities: [
        {
          name: 'mysql.databases.list',
          class: 'read',
          description: 'List databases visible to the connected MySQL user.',
          parameters: emptySchema(),
        },
        {
          name: 'mysql.tables.list',
          class: 'read',
          description: 'List base tables and views in one database.',
          parameters: {
            type: 'object',
            properties: { database: identifierSchema('Database name; defaults to the connection database.') },
            additionalProperties: false,
          },
        },
        {
          name: 'mysql.tables.describe',
          class: 'read',
          description: 'Read columns, types, nullability, defaults, and keys for one table.',
          parameters: {
            type: 'object',
            properties: {
              database: identifierSchema('Database name; defaults to the connection database.'),
              table: identifierSchema('Table name.'),
            },
            required: ['table'],
            additionalProperties: false,
          },
        },
        {
          name: 'mysql.query',
          class: 'read',
          description: 'Run one parameterized SELECT, SHOW, DESCRIBE, or EXPLAIN statement inside a read-only transaction.',
          parameters: statementSchema(false),
        },
        {
          name: 'mysql.execute',
          class: 'mutation',
          description: 'Run one approved parameterized INSERT, UPDATE, DELETE, or REPLACE statement and commit only when the affected-row count matches the caller expectation.',
          parameters: statementSchema(true),
          cas: 'optimistic-read-verify',
          externalEffect: true,
        },
      ],
    },

    async test(source) {
      try {
        await withConnection(source, createConnection, resolveHost, async (connection) => {
          await connection.ping()
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: safeErrorMessage(error) }
      }
    },

    async executeRead(inv) {
      const query = readQuery(inv)
      assertReadStatement(query.statement)
      const data = await withConnection(inv.source, createConnection, resolveHost, async (connection) => {
        await executeStatement(connection, {
          statement: 'START TRANSACTION READ ONLY',
          parameters: [],
        }, queryTimeout(inv.source))
        try {
          const [rows, fields] = await executeStatement(connection, query, queryTimeout(inv.source))
          if (!Array.isArray(rows)) throw new Error('MySQL read returned a non-row result')
          return boundedResult(rows, fields)
        } finally {
          await connection.rollback().catch(() => undefined)
        }
      })
      return { data, fetchedAt: Date.now() }
    },

    async executeMutation(inv) {
      if (inv.capabilityName !== 'mysql.execute') {
        throw new Error(`Unknown MySQL mutation capability: ${inv.capabilityName}`)
      }
      const query = readStatementArgs(inv.args)
      assertMutationStatement(query.statement)
      const expectedAffectedRows = readBoundedInteger(
        inv.args.expectedAffectedRows,
        -1,
        0,
        MAX_RESULT_ROWS,
        'expectedAffectedRows',
      )
      if (expectedAffectedRows < 0) throw new Error('expectedAffectedRows is required')
      return withConnection(inv.source, createConnection, resolveHost, async (connection) => {
        await connection.beginTransaction()
        try {
          const [result] = await executeStatement(connection, query, queryTimeout(inv.source))
          const affectedRows = readAffectedRows(result)
          if (affectedRows !== expectedAffectedRows) {
            await connection.rollback()
            return {
              status: 'conflict',
              alternatives: [],
              currentState: { affectedRows },
              message: `MySQL write affected ${affectedRows} rows; expected ${expectedAffectedRows}. The transaction was rolled back.`,
            }
          }
          await connection.commit()
          return committedMutation(result, affectedRows)
        } catch (error) {
          await connection.rollback().catch(() => undefined)
          throw error
        }
      })
    },
  }
}

export const mysqlConnector = createMySqlConnector()

async function defaultCreateConnection(config: ConnectionOptions): Promise<MySqlConnectionLike> {
  return createMysqlConnection(config) as Promise<MySqlConnectionLike>
}

async function withConnection<T>(
  source: ResolvedDataSource,
  createConnection: (config: ConnectionOptions) => Promise<MySqlConnectionLike>,
  resolveHost: (host: string) => Promise<string[]>,
  run: (connection: MySqlConnectionLike) => Promise<T>,
): Promise<T> {
  const credentials = readCredentials(source)
  const addresses = await resolveHost(credentials.host)
  if (addresses.length === 0) throw new Error('MySQL host did not resolve')
  const address = addresses[0]!
  let connection: MySqlConnectionLike | undefined
  try {
    connection = await createConnection({
      host: credentials.host,
      port: credentials.port,
      user: credentials.user,
      password: credentials.password,
      database: credentials.database,
      connectTimeout: credentials.connectTimeoutMs,
      multipleStatements: false,
      namedPlaceholders: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: false,
      dateStrings: true,
      timezone: 'Z',
      charset: 'utf8mb4',
      enableKeepAlive: true,
      maxPreparedStatements: 100,
      stream: () => createSocket({ host: address, port: credentials.port }),
      ssl: {
        ca: credentials.tlsCa,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        verifyIdentity: true,
      },
    })
    return await run(connection)
  } finally {
    if (connection) await connection.end().catch(() => undefined)
  }
}

function readCredentials(source: ResolvedDataSource): MySqlCredentials {
  let raw: unknown
  if (source.credentials.kind === 'custom') raw = source.credentials.values
  else if (source.credentials.kind === 'api-key') {
    try {
      raw = JSON.parse(source.credentials.apiKey)
    } catch {
      throw new Error('MySQL credential must be valid JSON')
    }
  } else {
    throw new Error('MySQL requires a structured credential bundle')
  }
  if (!isPlainRecord(raw)) throw new Error('MySQL credential must be a JSON object')
  const host = requiredCredentialString(raw.host, 'host', 253)
  validateHost(host)
  const user = requiredCredentialString(raw.user ?? raw.username, 'user', 128)
  const password = requiredCredentialString(raw.password, 'password', 4_096)
  const database = readOptionalString(raw.database, 'database')
  if (database && database.length > 64) throw new Error('MySQL credential database exceeds 64 characters')
  const tlsCa = readOptionalString(raw.tlsCa, 'tlsCa')
  if (tlsCa && Buffer.byteLength(tlsCa, 'utf8') > 1024 * 1024) {
    throw new Error('MySQL credential tlsCa exceeds the 1 MiB limit')
  }
  return {
    host,
    port: readBoundedInteger(raw.port, 3306, 1, 65_535, 'port'),
    user,
    password,
    database,
    tlsCa,
    connectTimeoutMs: readBoundedInteger(raw.connectTimeoutMs, 10_000, 1_000, 30_000, 'connectTimeoutMs'),
    queryTimeoutMs: readBoundedInteger(raw.queryTimeoutMs, DEFAULT_QUERY_TIMEOUT_MS, 1_000, 60_000, 'queryTimeoutMs'),
  }
}

function readQuery(inv: ConnectorInvocation): QueryInput {
  if (inv.capabilityName === 'mysql.databases.list') {
    return {
      statement: 'SELECT SCHEMA_NAME AS databaseName, DEFAULT_CHARACTER_SET_NAME AS characterSet, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME',
      parameters: [],
    }
  }
  if (inv.capabilityName === 'mysql.tables.list') {
    const database = readDatabase(inv.args.database, inv.source)
    return {
      statement: 'SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine, TABLE_ROWS AS estimatedRows, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
      parameters: [database],
    }
  }
  if (inv.capabilityName === 'mysql.tables.describe') {
    const database = readDatabase(inv.args.database, inv.source)
    const table = readIdentifier(inv.args.table, 'table')
    return {
      statement: 'SELECT COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, COLUMN_DEFAULT AS columnDefault, IS_NULLABLE AS isNullable, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, COLUMN_KEY AS columnKey, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      parameters: [database, table],
    }
  }
  if (inv.capabilityName === 'mysql.query') return readStatementArgs(inv.args)
  throw new Error(`Unknown MySQL read capability: ${inv.capabilityName}`)
}

function readStatementArgs(args: Record<string, unknown>): QueryInput {
  const statement = requiredString(args.statement, 'statement')
  if (Buffer.byteLength(statement, 'utf8') > 1024 * 1024) throw new Error('statement exceeds the 1 MiB limit')
  const parameters = args.parameters === undefined ? [] : args.parameters
  if (!Array.isArray(parameters) || parameters.length > MAX_PARAMETERS) {
    throw new Error(`parameters must be an array with at most ${MAX_PARAMETERS} entries`)
  }
  for (const [index, value] of parameters.entries()) {
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`parameters[${index}] must be a JSON scalar or null`)
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`parameters[${index}] must be finite`)
    }
  }
  if (Buffer.byteLength(JSON.stringify(parameters), 'utf8') > MAX_PARAMETER_BYTES) {
    throw new Error(`parameters exceed the ${MAX_PARAMETER_BYTES}-byte limit`)
  }
  return { statement, parameters }
}

function assertReadStatement(statement: string): void {
  const keyword = leadingKeyword(statement)
  if (!['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH'].includes(keyword)) {
    throw new Error('mysql.query accepts only SELECT, SHOW, DESCRIBE, or EXPLAIN statements')
  }
  if (/\b(?:INTO\s+(?:OUTFILE|DUMPFILE)|LOAD_FILE\s*\(|GET_LOCK\s*\(|RELEASE_LOCK\s*\(|SLEEP\s*\(|BENCHMARK\s*\(|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE)\b/i.test(statement)) {
    throw new Error('mysql.query rejects file, lock, and delay side effects')
  }
}

function assertMutationStatement(statement: string): void {
  const keyword = leadingKeyword(statement)
  if (!['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(keyword)) {
    throw new Error('mysql.execute accepts only INSERT, UPDATE, DELETE, or REPLACE statements')
  }
}

function leadingKeyword(statement: string): string {
  const withoutComments = statement
    .replace(/^\s*(?:--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/u, '')
    .trimStart()
  return /^[A-Za-z]+/.exec(withoutComments)?.[0]?.toUpperCase() ?? ''
}

async function executeStatement(
  connection: MySqlConnectionLike,
  query: QueryInput,
  timeout: number,
): Promise<[unknown, FieldPacket[]]> {
  return connection.execute({ sql: query.statement, values: query.parameters, timeout })
}

function boundedResult(rows: unknown[], fields: FieldPacket[]): unknown {
  if (rows.length > MAX_RESULT_ROWS) throw new Error(`MySQL result exceeds ${MAX_RESULT_ROWS} rows`)
  const data = {
    rows: jsonSafe(rows),
    columns: fields.map((field) => ({
      name: field.name,
      table: field.table,
      database: field.schema,
      type: field.type,
    })),
    rowCount: rows.length,
  }
  const serialized = JSON.stringify(data)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) {
    throw new Error(`MySQL result exceeds the ${MAX_RESULT_BYTES}-byte limit`)
  }
  return data
}

function readAffectedRows(result: unknown): number {
  if (!isPlainRecord(result) || !Number.isInteger(result.affectedRows) || (result.affectedRows as number) < 0) {
    throw new Error('MySQL mutation did not return an affected-row count')
  }
  return result.affectedRows as number
}

function committedMutation(result: unknown, affectedRows: number): CapabilityMutationResult {
  const header = result as ResultSetHeader
  const rawInsertId = (header as ResultSetHeader & { insertId?: number | string }).insertId
  const insertId = typeof rawInsertId === 'number' && Number.isSafeInteger(rawInsertId)
    ? rawInsertId
    : typeof rawInsertId === 'string'
      ? rawInsertId
      : undefined
  return {
    status: 'committed',
    data: jsonSafe({
      affectedRows,
      changedRows: header.changedRows,
      insertId,
      warningStatus: header.warningStatus,
    }),
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

function readDatabase(value: unknown, source: ResolvedDataSource): string {
  const explicit = value === undefined ? undefined : readIdentifier(value, 'database')
  if (explicit) return explicit
  const credentials = readCredentials(source)
  if (!credentials.database) throw new Error('database is required when the connection has no default database')
  return credentials.database
}

function queryTimeout(source: ResolvedDataSource): number {
  return readCredentials(source).queryTimeoutMs
}

function requiredString(value: unknown, label: string): string {
  const parsed = readOptionalString(value, label)
  if (!parsed) throw new Error(`${label} is required`)
  return parsed
}

function requiredCredentialString(value: unknown, label: string, maxLength: number): string {
  const parsed = readOptionalString(value, label)
  if (!parsed) throw new Error(`MySQL credential ${label} is required`)
  if (parsed.length > maxLength) throw new Error(`MySQL credential ${label} exceeds ${maxLength} characters`)
  return parsed
}

function readIdentifier(value: unknown, label: string): string {
  const parsed = requiredString(value, label)
  if (parsed.length > 64) throw new Error(`${label} exceeds 64 characters`)
  return parsed
}

function validateHost(host: string): void {
  const normalized = host.toLowerCase()
  if (
    host.length > 253 ||
    host.includes('://') ||
    /[\s/@]/.test(host) ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    (isIP(host) === 0 && !/^[A-Za-z0-9.-]+$/.test(host)) ||
    host.split('.').some((label) => !label || label.startsWith('-') || label.endsWith('-'))
  ) {
    throw new Error('MySQL host must be a public hostname or IP address without a scheme')
  }
}

function emptySchema(): Record<string, unknown> {
  return { type: 'object', properties: {}, additionalProperties: false }
}

function identifierSchema(description: string): Record<string, unknown> {
  return { type: 'string', minLength: 1, maxLength: 64, description }
}

function statementSchema(mutation: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    statement: { type: 'string', minLength: 1, maxLength: 1024 * 1024 },
    parameters: {
      type: 'array',
      maxItems: MAX_PARAMETERS,
      items: { type: ['string', 'number', 'boolean', 'null'] },
      description: 'Values bound to ? placeholders in order.',
    },
  }
  if (mutation) {
    properties.expectedAffectedRows = {
      type: 'integer',
      minimum: 0,
      maximum: MAX_RESULT_ROWS,
      description: 'Commit only when MySQL reports exactly this many affected rows.',
    }
  }
  return {
    type: 'object',
    properties,
    required: mutation ? ['statement', 'expectedAffectedRows'] : ['statement'],
    additionalProperties: false,
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'MySQL connection failed'
}
