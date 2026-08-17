import { isIP } from 'node:net'
import {
  createClient as createRedisClient,
  type RedisClientOptions,
} from 'redis'
import type { ConnectorAdapter, ResolvedDataSource } from '../types.js'
import {
  isPlainRecord,
  readBoolean,
  readBoundedInteger,
  readOptionalString,
} from './file-payload.js'
import { isPublicNetworkAddress, resolvePublicHostAddresses } from './public-network.js'

const MAX_KEY_BYTES = 1_024
const MAX_PATTERN_BYTES = 4_096
const MAX_VALUE_BYTES = 1024 * 1024
const MAX_SCAN_KEYS = 1_000
const MAX_SCAN_BYTES = 1024 * 1024
const MAX_TLS_CA_BYTES = 256 * 1024
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1_000

const SCAN_SCRIPT = `
local page
if ARGV[4] == '' then
  page = redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', ARGV[3])
else
  page = redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', ARGV[3], 'TYPE', ARGV[4])
end
local keys = page[2]
if #keys > tonumber(ARGV[5]) then return redis.error_reply('Redis SCAN page exceeds the configured key limit') end
local bytes = 0
for _, key in ipairs(keys) do
  if string.len(key) > tonumber(ARGV[7]) then return redis.error_reply('Redis SCAN key exceeds the configured key limit') end
  bytes = bytes + string.len(key)
  if bytes > tonumber(ARGV[6]) then return redis.error_reply('Redis SCAN page exceeds the configured byte limit') end
end
return page
`

const INSPECT_SCRIPT = `
local kind = redis.call('TYPE', KEYS[1])
if type(kind) == 'table' then kind = kind['ok'] end
return { kind, redis.call('PTTL', KEYS[1]) }
`

const READ_STRING_SCRIPT = `
local kind = redis.call('TYPE', KEYS[1])
if type(kind) == 'table' then kind = kind['ok'] end
local ttl = redis.call('PTTL', KEYS[1])
if kind == 'none' then return { kind, ttl, false, 0 } end
if kind ~= 'string' then return redis.error_reply('WRONGTYPE key does not contain a string') end
local length = redis.call('STRLEN', KEYS[1])
if length > tonumber(ARGV[1]) then return redis.error_reply('Redis value exceeds the configured read limit') end
return { kind, ttl, redis.call('GET', KEYS[1]), length }
`

const COMPARE_SET_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[3] ~= '' then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
elseif ARGV[4] == '1' then
  redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
else
  redis.call('SET', KEYS[1], ARGV[2])
end
return 1
`

const COMPARE_DELETE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`

interface RedisClientLike {
  readonly isOpen: boolean
  on(event: 'error', listener: (error: Error) => void): this
  connect(): Promise<unknown>
  close(): Promise<unknown>
  destroy(): void
  ping(): Promise<string>
  set(key: string, value: string, options: RedisSetOptions): Promise<string | null>
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>
}

interface RedisSetOptions {
  condition: 'NX' | 'XX'
  expiration?: { type: 'PX'; value: number } | 'KEEPTTL'
}

type CreateRedisClient = (options: RedisClientOptions) => RedisClientLike

export interface RedisConnectorOptions {
  createClient?: CreateRedisClient
  resolveHost?: (host: string) => Promise<string[]>
}

interface RedisCredentials {
  host: string
  port: number
  username?: string
  password: string
  database: number
  tlsCa?: string
  connectTimeoutMs: number
  commandTimeoutMs: number
  secrets: string[]
}

export function createRedisConnector(options: RedisConnectorOptions = {}): ConnectorAdapter {
  const createClient = options.createClient ?? defaultCreateClient
  const resolveHost = options.resolveHost ?? resolvePublicHostAddresses

  return {
    manifest: {
      kind: 'redis',
      displayName: 'Redis',
      description: 'Inspect and scan Redis keys and perform bounded, approved string compare-and-swap mutations over verified TLS.',
      auth: {
        kind: 'api-key',
        hint: 'JSON with a public Redis host, password, optional ACL username/database, and optional TLS CA. Verified TLS is mandatory.',
      },
      defaultConsistencyModel: 'authoritative',
      category: 'database',
      rateLimit: { requests: 120, windowMs: 60_000, scope: 'data-source' },
      capabilities: [
        readCapability('redis.keys.scan', 'Read one bounded SCAN page without blocking the server with KEYS.', {
          type: 'object',
          properties: {
            cursor: { type: 'string', pattern: '^[0-9]+$', default: '0' },
            match: { type: 'string', maxLength: MAX_PATTERN_BYTES, default: '*' },
            count: { type: 'integer', minimum: 1, maximum: MAX_SCAN_KEYS, default: 100 },
            type: { type: 'string', enum: ['string', 'list', 'set', 'zset', 'hash', 'stream'] },
          },
          additionalProperties: false,
        }),
        readCapability('redis.key.inspect', 'Read a key type and remaining expiry atomically.', keySchema()),
        readCapability('redis.string.get', 'Read one bounded string value, type, and remaining expiry atomically.', keySchema()),
        mutationCapability('redis.string.set', 'Set a bounded string only when the key is absent, present, or matches an expected value.', {
          type: 'object',
          properties: {
            key: keyParameter(),
            value: { type: 'string', maxLength: MAX_VALUE_BYTES },
            condition: { type: 'string', enum: ['absent', 'present', 'matches'] },
            expectedValue: { type: 'string', maxLength: MAX_VALUE_BYTES },
            ttlMs: { type: 'integer', minimum: 1, maximum: MAX_TTL_MS },
            keepTtl: { type: 'boolean', default: false },
          },
          required: ['key', 'value', 'condition'],
          additionalProperties: false,
        }),
        mutationCapability('redis.string.delete', 'Delete a string key only when its current value exactly matches the caller expectation.', {
          type: 'object',
          properties: {
            key: keyParameter(),
            expectedValue: { type: 'string', maxLength: MAX_VALUE_BYTES },
          },
          required: ['key', 'expectedValue'],
          additionalProperties: false,
        }),
      ],
    },

    async test(source) {
      try {
        await withClient(source, createClient, resolveHost, async (client) => {
          const response = await client.ping()
          if (response !== 'PONG') throw new Error('Redis PING returned an unexpected response')
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: safeErrorMessage(error, credentialSecrets(source)) }
      }
    },

    async executeRead({ source, capabilityName, args }) {
      if (capabilityName === 'redis.keys.scan') {
        const cursor = readCursor(args.cursor)
        const match = readPattern(args.match)
        const count = readBoundedInteger(args.count, 100, 1, MAX_SCAN_KEYS, 'count')
        const type = readScanType(args.type)
        const data = await withClient(source, createClient, resolveHost, async (client) => {
          const reply = readArrayReply(await client.eval(SCAN_SCRIPT, {
            keys: [],
            arguments: [
              cursor,
              match,
              String(count),
              type ?? '',
              String(MAX_SCAN_KEYS),
              String(MAX_SCAN_BYTES),
              String(MAX_KEY_BYTES),
            ],
          }), 'scan')
          const keys = readStringArray(reply[1], 'scan keys')
          assertScanPage(keys)
          return { cursor: readCursor(readReplyString(reply[0], 'cursor')), keys }
        })
        return { data, fetchedAt: Date.now() }
      }
      if (capabilityName === 'redis.key.inspect') {
        const key = readKey(args.key)
        const data = await withClient(source, createClient, resolveHost, async (client) => {
          const reply = readArrayReply(await client.eval(INSPECT_SCRIPT, { keys: [key], arguments: [] }), 'inspect')
          const type = readReplyString(reply[0], 'type')
          return { key, exists: type !== 'none', type, ttlMs: normalizeTtl(reply[1]) }
        })
        return { data, fetchedAt: Date.now() }
      }
      if (capabilityName === 'redis.string.get') {
        const key = readKey(args.key)
        const data = await withClient(source, createClient, resolveHost, async (client) => {
          const reply = readArrayReply(await client.eval(READ_STRING_SCRIPT, {
            keys: [key],
            arguments: [String(MAX_VALUE_BYTES)],
          }), 'string read')
          const type = readReplyString(reply[0], 'type')
          const exists = type !== 'none'
          const value = exists ? readReplyString(reply[2], 'value') : null
          if (value !== null && Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
            throw new Error(`Redis value exceeds the ${MAX_VALUE_BYTES}-byte limit`)
          }
          return {
            key,
            exists,
            type,
            ttlMs: normalizeTtl(reply[1]),
            value,
            byteLength: exists ? readReplyInteger(reply[3], 'byteLength') : 0,
          }
        })
        return { data, fetchedAt: Date.now() }
      }
      throw new Error(`Unknown Redis read capability: ${capabilityName}`)
    },

    async executeMutation({ source, capabilityName, args }) {
      if (capabilityName === 'redis.string.set') {
        const input = readSetInput(args)
        return withClient(source, createClient, resolveHost, async (client) => {
          let committed: boolean
          if (input.condition === 'matches') {
            committed = readReplyInteger(await client.eval(COMPARE_SET_SCRIPT, {
              keys: [input.key],
              arguments: [input.expectedValue!, input.value, input.ttlMs === undefined ? '' : String(input.ttlMs), input.keepTtl ? '1' : '0'],
            }), 'compare-and-set result') === 1
          } else {
            const response = await client.set(input.key, input.value, {
              condition: input.condition === 'absent' ? 'NX' : 'XX',
              expiration: input.ttlMs === undefined
                ? (input.keepTtl ? 'KEEPTTL' : undefined)
                : { type: 'PX', value: input.ttlMs },
            })
            committed = response === 'OK'
          }
          if (!committed) return conflict(`Redis key ${input.key} did not satisfy condition ${input.condition}`)
          return committedResult({ key: input.key, condition: input.condition, byteLength: Buffer.byteLength(input.value, 'utf8') })
        })
      }
      if (capabilityName === 'redis.string.delete') {
        const key = readKey(args.key)
        const expectedValue = readValue(args.expectedValue, 'expectedValue')
        return withClient(source, createClient, resolveHost, async (client) => {
          const deleted = readReplyInteger(await client.eval(COMPARE_DELETE_SCRIPT, {
            keys: [key],
            arguments: [expectedValue],
          }), 'compare-and-delete result')
          if (deleted !== 1) return conflict(`Redis key ${key} did not match the expected value`)
          return committedResult({ key, deleted: true })
        })
      }
      throw new Error(`Unknown Redis mutation capability: ${capabilityName}`)
    },
  }
}

export const redisConnector = createRedisConnector()

function defaultCreateClient(options: RedisClientOptions): RedisClientLike {
  return createRedisClient(options) as unknown as RedisClientLike
}

async function withClient<T>(
  source: ResolvedDataSource,
  createClient: CreateRedisClient,
  resolveHost: (host: string) => Promise<string[]>,
  run: (client: RedisClientLike) => Promise<T>,
): Promise<T> {
  const credentials = readCredentials(source)
  const addresses = await resolveHost(credentials.host)
  if (addresses.length === 0) throw new Error('Redis host did not resolve')
  let client: RedisClientLike | undefined
  try {
    client = createClient({
      username: credentials.username,
      password: credentials.password,
      database: credentials.database,
      name: 'tangle-integration-hub',
      disableOfflineQueue: true,
      commandsQueueMaxLength: 10,
      maintNotifications: 'disabled',
      commandOptions: { abortSignal: AbortSignal.timeout(credentials.commandTimeoutMs) },
      socket: {
        host: addresses[0]!,
        port: credentials.port,
        tls: true,
        servername: isIP(credentials.host) === 0 ? credentials.host : undefined,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        ca: credentials.tlsCa,
        connectTimeout: credentials.connectTimeoutMs,
        socketTimeout: credentials.commandTimeoutMs,
        reconnectStrategy: false,
      },
    })
    client.on('error', () => undefined)
    await client.connect()
    return await run(client)
  } catch (error) {
    throw new Error(safeErrorMessage(error, credentials.secrets))
  } finally {
    if (client?.isOpen) await client.close().catch(() => client?.destroy())
    else client?.destroy()
  }
}

function readCredentials(source: ResolvedDataSource): RedisCredentials {
  let raw: unknown
  if (source.credentials.kind === 'custom') raw = source.credentials.values
  else if (source.credentials.kind === 'api-key') {
    try {
      raw = JSON.parse(source.credentials.apiKey)
    } catch {
      throw new Error('Redis credential must be valid JSON')
    }
  } else {
    throw new Error('Redis requires a structured credential bundle')
  }
  if (!isPlainRecord(raw)) throw new Error('Redis credential must be a JSON object')
  const host = readHost(raw.host)
  const username = readOptionalString(raw.username, 'username')
  if (username && (username.length > 128 || /[\u0000-\u001f\u007f]/.test(username))) {
    throw new Error('Redis username must be at most 128 characters without control characters')
  }
  const password = readRequiredString(raw.password, 'password', 4_096)
  const tlsCa = readOptionalString(raw.tlsCa, 'tlsCa')
  if (tlsCa && Buffer.byteLength(tlsCa, 'utf8') > MAX_TLS_CA_BYTES) {
    throw new Error(`Redis tlsCa exceeds the ${MAX_TLS_CA_BYTES}-byte limit`)
  }
  return {
    host,
    port: readBoundedInteger(raw.port, 6380, 1, 65_535, 'port'),
    username,
    password,
    database: readBoundedInteger(raw.database, 0, 0, 65_535, 'database'),
    tlsCa,
    connectTimeoutMs: readBoundedInteger(raw.connectTimeoutMs, 10_000, 1_000, 30_000, 'connectTimeoutMs'),
    commandTimeoutMs: readBoundedInteger(raw.commandTimeoutMs, 10_000, 1_000, 30_000, 'commandTimeoutMs'),
    secrets: [password],
  }
}

function readHost(value: unknown): string {
  const host = readRequiredString(value, 'host', 253)
  const ipVersion = isIP(host)
  if (ipVersion !== 0) {
    if (!isPublicNetworkAddress(host)) throw new Error('Redis host is not a public network target')
    return host
  }
  const normalized = host.toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    /[\s/@:\[\]]/.test(host)
  ) {
    throw new Error('Redis host must be a public hostname or IP address without a scheme or port')
  }
  return host
}

function readSetInput(args: Record<string, unknown>) {
  const key = readKey(args.key)
  const value = readValue(args.value, 'value')
  const condition = args.condition
  if (!['absent', 'present', 'matches'].includes(String(condition))) {
    throw new Error('condition must be absent, present, or matches')
  }
  const expectedValue = args.expectedValue === undefined ? undefined : readValue(args.expectedValue, 'expectedValue')
  if (condition === 'matches' && expectedValue === undefined) throw new Error('expectedValue is required when condition is matches')
  if (condition !== 'matches' && expectedValue !== undefined) throw new Error('expectedValue is only valid when condition is matches')
  const ttlMs = args.ttlMs === undefined
    ? undefined
    : readBoundedInteger(args.ttlMs, 0, 1, MAX_TTL_MS, 'ttlMs')
  const keepTtl = readBoolean(args.keepTtl, false, 'keepTtl')
  if (ttlMs !== undefined && keepTtl) throw new Error('ttlMs and keepTtl cannot be used together')
  return { key, value, condition: condition as 'absent' | 'present' | 'matches', expectedValue, ttlMs, keepTtl }
}

function readCursor(value: unknown): string {
  if (value === undefined || value === null || value === '') return '0'
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value) || value.length > 32) {
    throw new Error('cursor must be a Redis numeric cursor string')
  }
  return value
}

function readPattern(value: unknown): string {
  if (value === undefined || value === null || value === '') return '*'
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_PATTERN_BYTES || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`match must be under ${MAX_PATTERN_BYTES} bytes without control characters`)
  }
  return value
}

function readScanType(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (!['string', 'list', 'set', 'zset', 'hash', 'stream'].includes(String(value))) {
    throw new Error('type must be string, list, set, zset, hash, or stream')
  }
  return String(value)
}

function assertScanPage(keys: string[]): void {
  if (!Array.isArray(keys) || keys.length > MAX_SCAN_KEYS) {
    throw new Error(`Redis SCAN page exceeds ${MAX_SCAN_KEYS} keys`)
  }
  if (
    keys.some((key) => typeof key !== 'string' || Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES || /[\u0000-\u001f\u007f]/.test(key)) ||
    Buffer.byteLength(JSON.stringify(keys), 'utf8') > MAX_SCAN_BYTES
  ) {
    throw new Error(`Redis SCAN page exceeds the ${MAX_SCAN_BYTES}-byte limit`)
  }
}

function readKey(value: unknown): string {
  return readBoundedString(value, 'key', MAX_KEY_BYTES)
}

function readValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_VALUE_BYTES}-byte limit`)
  }
  return value
}

function readBoundedString(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maxBytes || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a non-empty string under ${maxBytes} bytes without control characters`)
  }
  return value
}

function readRequiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters`)
  }
  return value
}

function readArrayReply(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Redis ${label} returned a malformed response`)
  return value
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Redis response ${label} is malformed`)
  return value.map((entry) => readReplyString(entry, label))
}

function readReplyString(value: unknown, label: string): string {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  throw new Error(`Redis response ${label} is malformed`)
}

function readReplyInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'bigint' ? Number(value) : typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) throw new Error(`Redis response ${label} is malformed`)
  return parsed
}

function normalizeTtl(value: unknown): number | null {
  const ttl = readReplyInteger(value, 'ttlMs')
  return ttl >= 0 ? ttl : null
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

function committedResult(data: unknown) {
  return { status: 'committed' as const, data, committedAt: Date.now(), idempotentReplay: false }
}

function conflict(message: string) {
  return { status: 'conflict' as const, alternatives: [], currentState: null, message }
}

function readCapability(name: string, description: string, parameters: Record<string, unknown>) {
  return { name, class: 'read' as const, description, parameters }
}

function mutationCapability(name: string, description: string, parameters: Record<string, unknown>) {
  return { name, class: 'mutation' as const, description, parameters, cas: 'optimistic-read-verify' as const, externalEffect: true }
}

function keyParameter() {
  return { type: 'string', minLength: 1, maxLength: MAX_KEY_BYTES }
}

function keySchema() {
  return {
    type: 'object',
    properties: { key: keyParameter() },
    required: ['key'],
    additionalProperties: false,
  }
}
