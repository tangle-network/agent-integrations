import { isIP } from 'node:net'
import {
  Client as PgClient,
  type ClientConfig,
  type FieldDef,
  type QueryConfig,
} from 'pg'
import type { ConnectorAdapter, ConnectorInvocation, ResolvedDataSource } from '../types.js'
import {
  isPlainRecord,
  jsonSafe,
  readBoundedInteger,
  readOptionalString,
} from './file-payload.js'
import { isPublicNetworkAddress, resolvePublicHostAddresses } from './public-network.js'

const MAX_IDENTIFIER_BYTES = 127
const MAX_COLUMNS = 64
const MAX_FILTERS = 20
const MAX_ORDER_COLUMNS = 8
const MAX_PARAMETERS_BYTES = 10 * 1024 * 1024
const MAX_RESULT_ROWS = 10_000
const MAX_RESULT_BYTES = 10 * 1024 * 1024
const MAX_TLS_CA_BYTES = 256 * 1024

interface RedshiftQueryResult {
  rows: unknown[]
  fields: FieldDef[]
  rowCount: number | null
}

interface RedshiftClientLike {
  on(event: 'error', listener: (error: Error) => void): this
  connect(): Promise<unknown>
  query(config: QueryConfig): Promise<RedshiftQueryResult>
  end(): Promise<void>
}

type CreateRedshiftClient = (config: ClientConfig) => RedshiftClientLike

export interface PostgresWireReadConnectorOptions {
  createClient?: CreateRedshiftClient
  resolveHost?: (host: string) => Promise<string[]>
}

export interface RedshiftConnectorOptions extends PostgresWireReadConnectorOptions {}

export interface PostgresWireReadProviderDefinition {
  kind: string
  displayName: string
  description: string
  authHint: string
  defaultPort: number
}

interface RedshiftCredentials {
  host: string
  port: number
  user: string
  password: string
  database: string
  tlsCa?: string
  connectTimeoutMs: number
  queryTimeoutMs: number
  secrets: string[]
}

interface RedshiftQuery {
  text: string
  values: unknown[]
}

const REDSHIFT_PROVIDER: PostgresWireReadProviderDefinition = {
  kind: 'redshift',
  displayName: 'Amazon Redshift',
  description: 'Inspect Redshift schemas and tables and run bounded structured row reads over the verified PostgreSQL wire protocol.',
  authHint: 'JSON with a public Redshift host, database, user, password, optional port, and optional TLS CA. Verified TLS is mandatory.',
  defaultPort: 5439,
}

export function createRedshiftConnector(options: RedshiftConnectorOptions = {}): ConnectorAdapter {
  return createPostgresWireReadConnector(REDSHIFT_PROVIDER, options)
}

export function createPostgresWireReadConnector(
  provider: PostgresWireReadProviderDefinition,
  options: PostgresWireReadConnectorOptions = {},
): ConnectorAdapter {
  const createClient = options.createClient ?? defaultCreateClient
  const resolveHost = options.resolveHost ?? resolvePublicHostAddresses

  return {
    manifest: {
      kind: provider.kind,
      displayName: provider.displayName,
      description: provider.description,
      auth: {
        kind: 'api-key',
        hint: provider.authHint,
      },
      defaultConsistencyModel: 'authoritative',
      category: 'database',
      rateLimit: { requests: 120, windowMs: 60_000, scope: 'data-source' },
      capabilities: [
        readCapability(`${provider.kind}.schemas.list`, `List schemas visible to the connected ${provider.displayName} user.`, emptySchema()),
        readCapability(`${provider.kind}.tables.list`, 'List tables and views in one schema.', {
          type: 'object',
          properties: { schema: identifierSchema('Schema name; defaults to public.') },
          additionalProperties: false,
        }),
        readCapability(`${provider.kind}.tables.describe`, 'Read ordered column metadata for one table or view.', {
          type: 'object',
          properties: {
            schema: identifierSchema('Schema name; defaults to public.'),
            table: identifierSchema('Table or view name.'),
          },
          required: ['table'],
          additionalProperties: false,
        }),
        readCapability(`${provider.kind}.rows.select`, 'Read bounded rows using an identifier-safe query builder with scalar predicates.', {
          type: 'object',
          properties: {
            schema: identifierSchema('Schema name; defaults to public.'),
            table: identifierSchema('Table or view name.'),
            columns: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_COLUMNS,
              uniqueItems: true,
              items: identifierSchema('Column name.'),
            },
            filters: {
              type: 'array',
              maxItems: MAX_FILTERS,
              items: {
                type: 'object',
                properties: {
                  column: identifierSchema('Column name.'),
                  operator: { type: 'string', enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'like', 'is-null', 'not-null'] },
                  value: { type: ['string', 'number', 'boolean', 'null'] },
                },
                required: ['column', 'operator'],
                additionalProperties: false,
              },
            },
            orderBy: {
              type: 'array',
              maxItems: MAX_ORDER_COLUMNS,
              items: {
                type: 'object',
                properties: {
                  column: identifierSchema('Column name.'),
                  direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
                },
                required: ['column'],
                additionalProperties: false,
              },
            },
            limit: { type: 'integer', minimum: 1, maximum: MAX_RESULT_ROWS, default: 100 },
            offset: { type: 'integer', minimum: 0, maximum: 1_000_000, default: 0 },
          },
          required: ['table', 'columns'],
          additionalProperties: false,
        }),
      ],
    },

    async test(source) {
      try {
        await withClient(source, provider, createClient, resolveHost, async (client) => {
          await client.query({ text: 'SELECT current_database() AS database_name, current_user AS user_name', values: [] })
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: safeErrorMessage(error, credentialSecrets(source, provider)) }
      }
    },

    async executeRead(inv) {
      const query = buildQuery(inv, provider)
      const data = await withClient(inv.source, provider, createClient, resolveHost, async (client) => {
        await client.query({ text: 'BEGIN READ ONLY', values: [] })
        try {
          const result = await client.query(query)
          return boundedResult(result, provider.displayName)
        } finally {
          await client.query({ text: 'ROLLBACK', values: [] }).catch(() => undefined)
        }
      })
      return { data, fetchedAt: Date.now() }
    },
  }
}

export const redshiftConnector = createRedshiftConnector()

function defaultCreateClient(config: ClientConfig): RedshiftClientLike {
  return new PgClient(config) as unknown as RedshiftClientLike
}

async function withClient<T>(
  source: ResolvedDataSource,
  provider: PostgresWireReadProviderDefinition,
  createClient: CreateRedshiftClient,
  resolveHost: (host: string) => Promise<string[]>,
  run: (client: RedshiftClientLike) => Promise<T>,
): Promise<T> {
  const credentials = readCredentials(source, provider)
  const addresses = await resolveHost(credentials.host)
  if (addresses.length === 0) throw new Error(`${provider.displayName} host did not resolve`)
  let client: RedshiftClientLike | undefined
  try {
    client = createClient({
      host: addresses[0]!,
      port: credentials.port,
      user: credentials.user,
      password: credentials.password,
      database: credentials.database,
      application_name: 'tangle-integration-hub',
      connectionTimeoutMillis: credentials.connectTimeoutMs,
      query_timeout: credentials.queryTimeoutMs,
      statement_timeout: credentials.queryTimeoutMs,
      lock_timeout: credentials.queryTimeoutMs,
      keepAlive: true,
      keepAliveInitialDelayMillis: 60_000,
      ssl: {
        servername: isIP(credentials.host) === 0 ? credentials.host : undefined,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        ca: credentials.tlsCa,
      },
    })
    client.on('error', () => undefined)
    await client.connect()
    return await run(client)
  } catch (error) {
    throw new Error(safeErrorMessage(error, credentials.secrets))
  } finally {
    await client?.end().catch(() => undefined)
  }
}

function readCredentials(
  source: ResolvedDataSource,
  provider: PostgresWireReadProviderDefinition,
): RedshiftCredentials {
  let raw: unknown
  if (source.credentials.kind === 'custom') raw = source.credentials.values
  else if (source.credentials.kind === 'api-key') {
    try {
      raw = JSON.parse(source.credentials.apiKey)
    } catch {
      throw new Error(`${provider.displayName} credential must be valid JSON`)
    }
  } else {
    throw new Error(`${provider.displayName} requires a structured credential bundle`)
  }
  if (!isPlainRecord(raw)) throw new Error(`${provider.displayName} credential must be a JSON object`)
  const host = readHost(raw.host, provider.displayName)
  const user = readCredentialString(raw.user ?? raw.username, 'user', 128, provider.displayName)
  const password = readCredentialString(raw.password, 'password', 4_096, provider.displayName)
  const database = readCredentialString(raw.database, 'database', MAX_IDENTIFIER_BYTES, provider.displayName)
  const tlsCa = readOptionalString(raw.tlsCa, 'tlsCa')
  if (tlsCa && Buffer.byteLength(tlsCa, 'utf8') > MAX_TLS_CA_BYTES) {
    throw new Error(`${provider.displayName} tlsCa exceeds the ${MAX_TLS_CA_BYTES}-byte limit`)
  }
  return {
    host,
    port: readBoundedInteger(raw.port, provider.defaultPort, 1, 65_535, 'port'),
    user,
    password,
    database,
    tlsCa,
    connectTimeoutMs: readBoundedInteger(raw.connectTimeoutMs, 10_000, 1_000, 30_000, 'connectTimeoutMs'),
    queryTimeoutMs: readBoundedInteger(raw.queryTimeoutMs, 30_000, 1_000, 60_000, 'queryTimeoutMs'),
    secrets: [password],
  }
}

function buildQuery(inv: ConnectorInvocation, provider: PostgresWireReadProviderDefinition): RedshiftQuery {
  if (inv.capabilityName === `${provider.kind}.schemas.list`) {
    return {
      text: `SELECT schema_name AS "schemaName", schema_owner AS "schemaOwner" FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' ORDER BY schema_name LIMIT ${MAX_RESULT_ROWS + 1}`,
      values: [],
    }
  }
  if (inv.capabilityName === `${provider.kind}.tables.list`) {
    return {
      text: `SELECT table_schema AS "schemaName", table_name AS "tableName", table_type AS "tableType" FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name LIMIT ${MAX_RESULT_ROWS + 1}`,
      values: [readSchema(inv.args.schema)],
    }
  }
  if (inv.capabilityName === `${provider.kind}.tables.describe`) {
    return {
      text: `SELECT table_schema AS "schemaName", table_name AS "tableName", column_name AS "columnName", ordinal_position AS "ordinalPosition", column_default AS "columnDefault", is_nullable AS "isNullable", data_type AS "dataType", character_maximum_length AS "characterMaximumLength", numeric_precision AS "numericPrecision", numeric_scale AS "numericScale" FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position LIMIT ${MAX_RESULT_ROWS + 1}`,
      values: [readSchema(inv.args.schema), readIdentifier(inv.args.table, 'table')],
    }
  }
  if (inv.capabilityName === `${provider.kind}.rows.select`) return buildRowSelect(inv.args, provider.displayName)
  throw new Error(`Unknown ${provider.displayName} read capability: ${inv.capabilityName}`)
}

function buildRowSelect(args: Record<string, unknown>, providerLabel: string): RedshiftQuery {
  const schema = readSchema(args.schema)
  const table = readIdentifier(args.table, 'table')
  const columns = readIdentifierArray(args.columns, 'columns', MAX_COLUMNS, true)
  const filters = readFilters(args.filters)
  const orderBy = readOrderBy(args.orderBy)
  const limit = readBoundedInteger(args.limit, 100, 1, MAX_RESULT_ROWS, 'limit')
  const offset = readBoundedInteger(args.offset, 0, 0, 1_000_000, 'offset')
  const values: unknown[] = []
  const predicates = filters.map((filter) => {
    const column = quoteIdentifier(filter.column)
    if (filter.operator === 'is-null') return `${column} IS NULL`
    if (filter.operator === 'not-null') return `${column} IS NOT NULL`
    values.push(filter.value)
    return `${column} ${sqlOperator(filter.operator)} $${values.length}`
  })
  assertParameterBytes(values, providerLabel)
  const where = predicates.length > 0 ? ` WHERE ${predicates.join(' AND ')}` : ''
  const order = orderBy.length > 0
    ? ` ORDER BY ${orderBy.map((entry) => `${quoteIdentifier(entry.column)} ${entry.direction.toUpperCase()}`).join(', ')}`
    : ''
  return {
    text: `SELECT ${columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}${where}${order} LIMIT ${limit} OFFSET ${offset}`,
    values,
  }
}

function readFilters(value: unknown): Array<{ column: string; operator: string; value?: unknown }> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_FILTERS) throw new Error(`filters must contain at most ${MAX_FILTERS} entries`)
  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) throw new Error(`filters[${index}] must be an object`)
    const column = readIdentifier(entry.column, `filters[${index}].column`)
    const operator = entry.operator
    if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'like', 'is-null', 'not-null'].includes(String(operator))) {
      throw new Error(`filters[${index}].operator is unsupported`)
    }
    const valueRequired = !['is-null', 'not-null'].includes(String(operator))
    if (valueRequired) assertScalar(entry.value, `filters[${index}].value`)
    else if (entry.value !== undefined) throw new Error(`filters[${index}].value is not valid for ${operator}`)
    if (valueRequired && entry.value === null) throw new Error(`filters[${index}] must use is-null or not-null for null values`)
    if (operator === 'like' && typeof entry.value !== 'string') throw new Error(`filters[${index}].value must be a string for like`)
    return { column, operator: String(operator), value: entry.value }
  })
}

function readOrderBy(value: unknown): Array<{ column: string; direction: 'asc' | 'desc' }> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_ORDER_COLUMNS) throw new Error(`orderBy must contain at most ${MAX_ORDER_COLUMNS} entries`)
  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) throw new Error(`orderBy[${index}] must be an object`)
    const column = readIdentifier(entry.column, `orderBy[${index}].column`)
    const direction = entry.direction ?? 'asc'
    if (direction !== 'asc' && direction !== 'desc') throw new Error(`orderBy[${index}].direction must be asc or desc`)
    return { column, direction }
  })
}

function readIdentifierArray(value: unknown, label: string, max: number, required: boolean): string[] {
  if (!Array.isArray(value) || (required && value.length === 0) || value.length > max) {
    throw new Error(`${label} must contain ${required ? '1-' : '0-'}${max} identifiers`)
  }
  const identifiers = value.map((entry, index) => readIdentifier(entry, `${label}[${index}]`))
  if (new Set(identifiers).size !== identifiers.length) throw new Error(`${label} must not contain duplicates`)
  return identifiers
}

function boundedResult(result: RedshiftQueryResult, providerLabel: string): unknown {
  if (!Array.isArray(result.rows) || result.rows.length > MAX_RESULT_ROWS) {
    throw new Error(`${providerLabel} result exceeds ${MAX_RESULT_ROWS} rows`)
  }
  if (
    result.rowCount !== null &&
    (!Number.isSafeInteger(result.rowCount) || result.rowCount < 0 || result.rowCount > MAX_RESULT_ROWS)
  ) {
    throw new Error(`${providerLabel} result returned a malformed row count`)
  }
  const data = {
    rows: jsonSafe(result.rows),
    columns: result.fields.map((field) => ({
      name: field.name,
      tableId: field.tableID,
      columnId: field.columnID,
      dataTypeId: field.dataTypeID,
    })),
    rowCount: result.rowCount ?? result.rows.length,
  }
  const serialized = JSON.stringify(data)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) {
    throw new Error(`${providerLabel} result exceeds the ${MAX_RESULT_BYTES}-byte limit`)
  }
  return data
}

function assertParameterBytes(values: unknown[], providerLabel: string): void {
  if (Buffer.byteLength(JSON.stringify(values), 'utf8') > MAX_PARAMETERS_BYTES) {
    throw new Error(`${providerLabel} filter values exceed the ${MAX_PARAMETERS_BYTES}-byte limit`)
  }
}

function assertScalar(value: unknown, label: string): void {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`${label} must be a JSON scalar or null`)
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${label} must be finite`)
}

function sqlOperator(value: string): string {
  return ({ eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=', like: 'LIKE' } as Record<string, string>)[value]!
}

function readSchema(value: unknown): string {
  return value === undefined || value === null ? 'public' : readIdentifier(value, 'schema')
}

function readIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > MAX_IDENTIFIER_BYTES || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) {
    throw new Error(`${label} must be a SQL identifier under ${MAX_IDENTIFIER_BYTES} bytes`)
  }
  return value
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function readHost(value: unknown, providerLabel: string): string {
  const host = readCredentialString(value, 'host', 253, providerLabel)
  const ipVersion = isIP(host)
  if (ipVersion !== 0) {
    if (!isPublicNetworkAddress(host)) throw new Error(`${providerLabel} host is not a public network target`)
    return host
  }
  const normalized = host.toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    /[\s/@:\[\]]/.test(host)
  ) {
    throw new Error(`${providerLabel} host must be a public hostname or IP address without a scheme or port`)
  }
  return host
}

function readCredentialString(value: unknown, label: string, maxLength: number, providerLabel: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || (label !== 'password' && /[\u0000-\u001f\u007f]/.test(value))) {
    throw new Error(`${providerLabel} credential ${label} must be a non-empty string under ${maxLength} characters`)
  }
  return value
}

function safeErrorMessage(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) {
    if (secret.length >= 4) message = message.replaceAll(secret, '[REDACTED]')
  }
  return message
}

function credentialSecrets(source: ResolvedDataSource, provider: PostgresWireReadProviderDefinition): string[] {
  try {
    return readCredentials(source, provider).secrets
  } catch {
    return []
  }
}

function emptySchema() {
  return { type: 'object', properties: {}, additionalProperties: false }
}

function identifierSchema(description: string) {
  return { type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_BYTES, pattern: '^[A-Za-z_][A-Za-z0-9_$]*$', description }
}

function readCapability(name: string, description: string, parameters: Record<string, unknown>) {
  return { name, class: 'read' as const, description, parameters }
}
