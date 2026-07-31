import { isIP, type LookupFunction } from 'node:net'
import { createSecureContext } from 'node:tls'
import {
  BSON,
  MongoClient,
  type MongoClientOptions,
} from 'mongodb'
import type { ConnectorAdapter, ConnectorInvocation, ResolvedDataSource } from '../types.js'
import {
  isPlainRecord,
  readBoundedInteger,
  readOptionalString,
} from './file-payload.js'
import { isPublicNetworkAddress, resolvePublicHostAddresses } from './public-network.js'

const MAX_NAME_BYTES = 120
const MAX_FIELD_BYTES = 256
const MAX_FILTERS = 20
const MAX_PROJECTION_FIELDS = 64
const MAX_SORT_FIELDS = 8
const MAX_COLLECTIONS = 1_000
const MAX_INDEXES = 200
const MAX_DOCUMENTS = 1_000
const MAX_RESULT_BYTES = 10 * 1024 * 1024
const MAX_FILTER_BYTES = 1024 * 1024
const MAX_SCALAR_STRING_BYTES = 64 * 1024
const MAX_TLS_CA_BYTES = 256 * 1024

type MongoDocument = Record<string, unknown>

interface MongoCursorLike {
  next(): Promise<MongoDocument | null>
  close(): Promise<void>
}

interface MongoFindCursorLike extends MongoCursorLike {
  sort(specification: Record<string, 1 | -1>): this
  skip(value: number): this
  limit(value: number): this
}

interface MongoCollectionLike {
  find(filter: MongoDocument, options: { projection?: MongoDocument; maxTimeMS: number }): MongoFindCursorLike
  countDocuments(filter: MongoDocument, options: { maxTimeMS: number }): Promise<number>
  listIndexes(options: { maxTimeMS: number }): MongoCursorLike
}

interface MongoDatabaseLike {
  command(command: MongoDocument, options: { maxTimeMS: number }): Promise<MongoDocument>
  listCollections(filter: MongoDocument, options: { nameOnly: boolean; maxTimeMS: number }): MongoCursorLike
  collection(name: string): MongoCollectionLike
}

interface MongoClientLike {
  connect(): Promise<unknown>
  db(name: string): MongoDatabaseLike
  close(): Promise<void>
}

type CreateMongoClient = (uri: string, options: MongoClientOptions) => MongoClientLike

export interface MongoDbConnectorOptions {
  createClient?: CreateMongoClient
  resolveHost?: (host: string) => Promise<string[]>
}

interface MongoDbCredentials {
  host: string
  port: number
  database: string
  user: string
  password: string
  authSource: string
  tlsCa?: string
  connectTimeoutMs: number
  commandTimeoutMs: number
  secrets: string[]
}

type MongoReadRequest =
  | { kind: 'collections.list' }
  | { kind: 'collections.describe'; collection: string }
  | { kind: 'indexes.list'; collection: string }
  | {
    kind: 'documents.find'
    collection: string
    filter: MongoDocument
    projection?: MongoDocument
    sort: Record<string, 1 | -1>
    limit: number
    skip: number
  }
  | { kind: 'documents.count'; collection: string; filter: MongoDocument }

export function createMongoDbConnector(options: MongoDbConnectorOptions = {}): ConnectorAdapter {
  const createClient = options.createClient ?? defaultCreateClient
  const resolveHost = options.resolveHost ?? resolvePublicHostAddresses

  return {
    manifest: {
      kind: 'mongodb',
      displayName: 'MongoDB',
      description: 'Inspect MongoDB collections and indexes and run bounded structured document reads over a verified TLS connection.',
      auth: {
        kind: 'api-key',
        hint: 'JSON with a public MongoDB host, database, user, password, optional port/auth source, and optional TLS CA. Verified TLS is mandatory.',
      },
      category: 'database',
      defaultConsistencyModel: 'authoritative',
      rateLimit: { requests: 120, windowMs: 60_000, scope: 'data-source' },
      capabilities: [
        readCapability('mongodb.collections.list', 'List collections visible in the configured database.', {
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        readCapability('mongodb.collections.describe', 'Read options and metadata for one collection.', collectionSchema()),
        readCapability('mongodb.indexes.list', 'List bounded index metadata for one collection.', collectionSchema()),
        readCapability('mongodb.documents.find', 'Read bounded documents using fixed scalar predicates, projection, and sort fields.', {
          type: 'object',
          properties: {
            collection: nameParameter('Collection name.'),
            filters: filterArraySchema(),
            fields: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_PROJECTION_FIELDS,
              uniqueItems: true,
              items: fieldParameter(),
            },
            includeId: { type: 'boolean', default: true },
            sort: {
              type: 'array',
              maxItems: MAX_SORT_FIELDS,
              items: {
                type: 'object',
                properties: {
                  field: fieldParameter(),
                  direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
                },
                required: ['field'],
                additionalProperties: false,
              },
            },
            limit: { type: 'integer', minimum: 1, maximum: MAX_DOCUMENTS, default: 100 },
            skip: { type: 'integer', minimum: 0, maximum: 1_000_000, default: 0 },
          },
          required: ['collection'],
          additionalProperties: false,
        }),
        readCapability('mongodb.documents.count', 'Count documents matching fixed scalar predicates within a bounded server execution time.', {
          type: 'object',
          properties: {
            collection: nameParameter('Collection name.'),
            filters: filterArraySchema(),
          },
          required: ['collection'],
          additionalProperties: false,
        }),
      ],
    },

    async test(source) {
      try {
        await withClient(source, createClient, resolveHost, async (client, credentials) => {
          const response = await client.db(credentials.database).command(
            { ping: 1 },
            { maxTimeMS: credentials.commandTimeoutMs },
          )
          if (response.ok !== 1) throw new Error('MongoDB ping returned an unexpected response')
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: safeErrorMessage(error, credentialSecrets(source)) }
      }
    },

    async executeRead(invocation) {
      const request = prepareRead(invocation)
      const data = await withClient(invocation.source, createClient, resolveHost, async (client, credentials) => {
        return executeRead(request, client.db(credentials.database), credentials.commandTimeoutMs)
      })
      return { data, fetchedAt: Date.now() }
    },
  }
}

export const mongodbConnector = createMongoDbConnector()

function defaultCreateClient(uri: string, options: MongoClientOptions): MongoClientLike {
  return new MongoClient(uri, options) as unknown as MongoClientLike
}

async function withClient<T>(
  source: ResolvedDataSource,
  createClient: CreateMongoClient,
  resolveHost: (host: string) => Promise<string[]>,
  run: (client: MongoClientLike, credentials: MongoDbCredentials) => Promise<T>,
): Promise<T> {
  const credentials = readCredentials(source)
  const addresses = await resolveHost(credentials.host)
  if (addresses.length === 0) throw new Error('MongoDB host did not resolve')
  const uriHost = isIP(credentials.host) === 6 ? `[${credentials.host}]` : credentials.host
  const client = createClient(`mongodb://${uriHost}:${credentials.port}/`, {
    appName: 'tangle-integration-hub',
    auth: { username: credentials.user, password: credentials.password },
    authSource: credentials.authSource,
    connectTimeoutMS: credentials.connectTimeoutMs,
    directConnection: true,
    lookup: pinnedLookup(addresses[0]!),
    maxIdleTimeMS: 5_000,
    maxPoolSize: 1,
    minPoolSize: 0,
    rejectUnauthorized: true,
    retryReads: true,
    retryWrites: false,
    serverSelectionTimeoutMS: credentials.connectTimeoutMs,
    servername: isIP(credentials.host) === 0 ? credentials.host : undefined,
    secureContext: createSecureContext({ ca: credentials.tlsCa, minVersion: 'TLSv1.2' }),
    socketTimeoutMS: credentials.commandTimeoutMs,
    tls: true,
  })
  try {
    await client.connect()
    return await run(client, credentials)
  } catch (error) {
    throw new Error(safeErrorMessage(error, credentials.secrets))
  } finally {
    await client.close().catch(() => undefined)
  }
}

async function executeRead(
  request: MongoReadRequest,
  database: MongoDatabaseLike,
  commandTimeoutMs: number,
): Promise<unknown> {
  if (request.kind === 'collections.list') {
    const collections = await readCursor(
      database.listCollections({}, { nameOnly: true, maxTimeMS: commandTimeoutMs }),
      MAX_COLLECTIONS,
      'MongoDB collection list',
    )
    return boundedResult({ collections }, 'MongoDB collection list')
  }
  if (request.kind === 'collections.describe') {
    const matches = await readCursor(
      database.listCollections({ name: request.collection }, { nameOnly: false, maxTimeMS: commandTimeoutMs }),
      1,
      'MongoDB collection description',
    )
    return boundedResult({ collection: matches[0] ?? null }, 'MongoDB collection description')
  }
  if (request.kind === 'indexes.list') {
    const indexes = await readCursor(
      database.collection(request.collection).listIndexes({ maxTimeMS: commandTimeoutMs }),
      MAX_INDEXES,
      'MongoDB index list',
    )
    return boundedResult({ collection: request.collection, indexes }, 'MongoDB index list')
  }
  if (request.kind === 'documents.find') {
    const cursor = database.collection(request.collection).find(request.filter, {
      ...(request.projection ? { projection: request.projection } : {}),
      maxTimeMS: commandTimeoutMs,
    })
    if (Object.keys(request.sort).length > 0) cursor.sort(request.sort)
    cursor.skip(request.skip).limit(request.limit)
    const documents = await readCursor(cursor, request.limit, 'MongoDB document result')
    return boundedResult({ collection: request.collection, documents }, 'MongoDB document result')
  }
  if (request.kind === 'documents.count') {
    const count = await database.collection(request.collection).countDocuments(request.filter, { maxTimeMS: commandTimeoutMs })
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('MongoDB returned a malformed document count')
    return { collection: request.collection, count }
  }
}

function prepareRead(invocation: ConnectorInvocation): MongoReadRequest {
  if (invocation.capabilityName === 'mongodb.collections.list') return { kind: 'collections.list' }
  if (invocation.capabilityName === 'mongodb.collections.describe') {
    return { kind: 'collections.describe', collection: readCollectionName(invocation.args.collection) }
  }
  if (invocation.capabilityName === 'mongodb.indexes.list') {
    return { kind: 'indexes.list', collection: readCollectionName(invocation.args.collection) }
  }
  if (invocation.capabilityName === 'mongodb.documents.find') {
    return {
      kind: 'documents.find',
      collection: readCollectionName(invocation.args.collection),
      filter: readFilters(invocation.args.filters),
      projection: readProjection(invocation.args.fields, invocation.args.includeId),
      sort: readSort(invocation.args.sort),
      limit: readBoundedInteger(invocation.args.limit, 100, 1, MAX_DOCUMENTS, 'limit'),
      skip: readBoundedInteger(invocation.args.skip, 0, 0, 1_000_000, 'skip'),
    }
  }
  if (invocation.capabilityName === 'mongodb.documents.count') {
    return {
      kind: 'documents.count',
      collection: readCollectionName(invocation.args.collection),
      filter: readFilters(invocation.args.filters),
    }
  }
  throw new Error(`Unknown MongoDB read capability: ${invocation.capabilityName}`)
}

async function readCursor(
  cursor: MongoCursorLike,
  maximum: number,
  label: string,
): Promise<MongoDocument[]> {
  const entries: MongoDocument[] = []
  let serializedBytes = 2
  try {
    while (entries.length < maximum) {
      const entry = await cursor.next()
      if (entry === null) return entries
      serializedBytes += Buffer.byteLength(
        JSON.stringify(BSON.EJSON.serialize(entry, { relaxed: true })),
        'utf8',
      ) + 1
      if (serializedBytes > MAX_RESULT_BYTES) {
        throw new Error(`${label} exceeds the ${MAX_RESULT_BYTES}-byte limit`)
      }
      entries.push(entry)
    }
    if (await cursor.next() !== null) throw new Error(`${label} exceeds ${maximum} entries`)
    return entries
  } finally {
    await cursor.close().catch(() => undefined)
  }
}

function readCredentials(source: ResolvedDataSource): MongoDbCredentials {
  let raw: unknown
  if (source.credentials.kind === 'custom') raw = source.credentials.values
  else if (source.credentials.kind === 'api-key') {
    try {
      raw = JSON.parse(source.credentials.apiKey)
    } catch {
      throw new Error('MongoDB credential must be valid JSON')
    }
  } else {
    throw new Error('MongoDB requires a structured credential bundle')
  }
  if (!isPlainRecord(raw)) throw new Error('MongoDB credential must be a JSON object')
  const host = readHost(raw.host)
  const database = readDatabaseName(raw.database, 'database')
  const user = readCredentialString(raw.user ?? raw.username, 'user', 128)
  const password = readCredentialString(raw.password, 'password', 4_096)
  const authSource = raw.authSource === undefined
    ? 'admin'
    : readDatabaseName(raw.authSource, 'authSource')
  const tlsCa = readOptionalString(raw.tlsCa, 'tlsCa')
  if (tlsCa && Buffer.byteLength(tlsCa, 'utf8') > MAX_TLS_CA_BYTES) {
    throw new Error(`MongoDB tlsCa exceeds the ${MAX_TLS_CA_BYTES}-byte limit`)
  }
  return {
    host,
    port: readBoundedInteger(raw.port, 27_017, 1, 65_535, 'port'),
    database,
    user,
    password,
    authSource,
    tlsCa,
    connectTimeoutMs: readBoundedInteger(raw.connectTimeoutMs, 10_000, 1_000, 30_000, 'connectTimeoutMs'),
    commandTimeoutMs: readBoundedInteger(raw.commandTimeoutMs, 30_000, 1_000, 60_000, 'commandTimeoutMs'),
    secrets: [password],
  }
}

function readFilters(value: unknown): MongoDocument {
  if (value === undefined || value === null) return {}
  if (!Array.isArray(value) || value.length > MAX_FILTERS) {
    throw new Error(`filters must contain at most ${MAX_FILTERS} entries`)
  }
  const predicates = value.map((entry, index) => {
    if (!isPlainRecord(entry)) throw new Error(`filters[${index}] must be an object`)
    const field = readField(entry.field, `filters[${index}].field`)
    const operator = entry.operator
    if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(String(operator))) {
      throw new Error(`filters[${index}].operator is unsupported`)
    }
    const scalar = readScalar(entry.value, `filters[${index}].value`)
    return { [field]: { [mongoOperator(String(operator))]: scalar } }
  })
  const filter = predicates.length === 0 ? {} : { $and: predicates }
  if (Buffer.byteLength(JSON.stringify(filter), 'utf8') > MAX_FILTER_BYTES) {
    throw new Error(`MongoDB filters exceed the ${MAX_FILTER_BYTES}-byte limit`)
  }
  return filter
}

function readProjection(fieldsValue: unknown, includeIdValue: unknown): MongoDocument | undefined {
  const includeId = includeIdValue === undefined || includeIdValue === null
    ? true
    : readBoolean(includeIdValue, 'includeId')
  if (fieldsValue === undefined || fieldsValue === null) return includeId ? undefined : { _id: 0 }
  const fields = readFieldArray(fieldsValue, 'fields', MAX_PROJECTION_FIELDS, true)
  return Object.fromEntries([
    ...fields.map((field) => [field, 1] as const),
    ...(!includeId && !fields.includes('_id') ? [['_id', 0] as const] : []),
  ])
}

function readSort(value: unknown): Record<string, 1 | -1> {
  if (value === undefined || value === null) return {}
  if (!Array.isArray(value) || value.length > MAX_SORT_FIELDS) {
    throw new Error(`sort must contain at most ${MAX_SORT_FIELDS} entries`)
  }
  const entries = value.map((entry, index) => {
    if (!isPlainRecord(entry)) throw new Error(`sort[${index}] must be an object`)
    const field = readField(entry.field, `sort[${index}].field`)
    const direction = entry.direction ?? 'asc'
    if (direction !== 'asc' && direction !== 'desc') {
      throw new Error(`sort[${index}].direction must be asc or desc`)
    }
    return [field, direction === 'asc' ? 1 : -1] as const
  })
  if (new Set(entries.map(([field]) => field)).size !== entries.length) {
    throw new Error('sort must not contain duplicate fields')
  }
  return Object.fromEntries(entries)
}

function readFieldArray(value: unknown, label: string, maximum: number, required: boolean): string[] {
  if (!Array.isArray(value) || (required && value.length === 0) || value.length > maximum) {
    throw new Error(`${label} must contain ${required ? '1-' : '0-'}${maximum} fields`)
  }
  const fields = value.map((entry, index) => readField(entry, `${label}[${index}]`))
  if (new Set(fields).size !== fields.length) throw new Error(`${label} must not contain duplicates`)
  return fields
}

function readScalar(value: unknown, label: string): string | number | boolean | null {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite`)
    return value
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_SCALAR_STRING_BYTES) {
      throw new Error(`${label} exceeds the ${MAX_SCALAR_STRING_BYTES}-byte limit`)
    }
    return value
  }
  throw new Error(`${label} must be a JSON scalar or null`)
}

function mongoOperator(value: string): string {
  return ({ eq: '$eq', ne: '$ne', lt: '$lt', lte: '$lte', gt: '$gt', gte: '$gte' } as Record<string, string>)[value]!
}

function boundedResult(value: unknown, label: string): unknown {
  const serialized = BSON.EJSON.serialize(value, { relaxed: true })
  if (Buffer.byteLength(JSON.stringify(serialized), 'utf8') > MAX_RESULT_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_RESULT_BYTES}-byte limit`)
  }
  return serialized
}

function readHost(value: unknown): string {
  const host = readCredentialString(value, 'host', 253)
  const ipVersion = isIP(host)
  if (ipVersion !== 0) {
    if (!isPublicNetworkAddress(host)) throw new Error('MongoDB host is not a public network target')
    return host
  }
  const normalized = host.toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    /[\s/@:\[\]]/.test(host)
  ) {
    throw new Error('MongoDB host must be a public hostname or IP address without a scheme or port')
  }
  return host
}

function readName(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_NAME_BYTES ||
    /[\u0000-\u001f\u007f/\\]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty MongoDB name under ${MAX_NAME_BYTES} bytes`)
  }
  return value
}

function readCollectionName(value: unknown): string {
  const collection = readName(value, 'collection')
  if (collection.startsWith('system.') || collection.includes('$')) {
    throw new Error('collection must not target MongoDB system or command namespaces')
  }
  return collection
}

function readDatabaseName(value: unknown, label: string): string {
  const database = readName(value, label)
  if (Buffer.byteLength(database, 'utf8') > 63 || !/^[A-Za-z0-9_-]+$/.test(database)) {
    throw new Error(`${label} must use only letters, numbers, underscores, or hyphens and stay under 63 bytes`)
  }
  return database
}

function readField(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_FIELD_BYTES ||
    !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)
  ) {
    throw new Error(`${label} must be a dotted MongoDB field path under ${MAX_FIELD_BYTES} bytes`)
  }
  return value
}

function readCredentialString(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    (label !== 'password' && /[\u0000-\u001f\u007f]/.test(value))
  ) {
    throw new Error(`MongoDB credential ${label} must be a non-empty string under ${maximum} characters`)
  }
  return value
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address)
  return (_hostname, options, callback) => {
    const normalizedOptions = typeof options === 'number' ? { family: options } : options
    if (normalizedOptions?.family && normalizedOptions.family !== family) {
      callback(new Error('MongoDB pinned address does not match the requested network family'), '', 0)
      return
    }
    if (normalizedOptions?.all) {
      callback(null, [{ address, family }] as never, undefined as never)
      return
    }
    callback(null, address, family)
  }
}

function safeErrorMessage(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) {
    if (secret.length >= 4) message = message.replaceAll(secret, '[REDACTED]')
  }
  return message
}

function credentialSecrets(source: ResolvedDataSource): string[] {
  try {
    return readCredentials(source).secrets
  } catch {
    return []
  }
}

function collectionSchema() {
  return {
    type: 'object',
    properties: { collection: nameParameter('Collection name.') },
    required: ['collection'],
    additionalProperties: false,
  }
}

function filterArraySchema() {
  return {
    type: 'array',
    maxItems: MAX_FILTERS,
    items: {
      type: 'object',
      properties: {
        field: fieldParameter(),
        operator: { type: 'string', enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] },
        value: { type: ['string', 'number', 'boolean', 'null'] },
      },
      required: ['field', 'operator', 'value'],
      additionalProperties: false,
    },
  }
}

function nameParameter(description: string) {
  return { type: 'string', minLength: 1, maxLength: MAX_NAME_BYTES, description }
}

function fieldParameter() {
  return {
    type: 'string',
    minLength: 1,
    maxLength: MAX_FIELD_BYTES,
    pattern: '^[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*$',
  }
}

function readCapability(name: string, description: string, parameters: Record<string, unknown>) {
  return { name, class: 'read' as const, description, parameters }
}
