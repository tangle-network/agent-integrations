import { isIP } from 'node:net'
import tls from 'node:tls'
import {
  Kafka,
  logLevel,
  type Admin,
  type Consumer,
  type ISocketFactory,
  type KafkaConfig,
  type Producer,
  type SASLOptions,
} from 'kafkajs'
import type { ConnectorAdapter, ResolvedDataSource } from '../types.js'
import {
  MAX_FILE_BYTES,
  isPlainRecord,
  jsonSafe,
  readBoolean,
  readBoundedInteger,
  readOptionalString,
} from './file-payload.js'
import { isPublicNetworkAddress, publicDnsLookup } from './public-network.js'

interface KafkaClientLike {
  admin(): Admin
  producer(options?: Parameters<Kafka['producer']>[0]): Producer
  consumer(options: Parameters<Kafka['consumer']>[0]): Consumer
}

export interface KafkaConnectorOptions {
  createClient?: (config: KafkaConfig) => KafkaClientLike
}

interface KafkaCredentials {
  config: KafkaConfig
}

const MAX_TOPICS = 100
const MAX_MESSAGES = 100
const MAX_MESSAGE_BYTES = 1024 * 1024
const MAX_BATCH_BYTES = MAX_FILE_BYTES
const MAX_HEADERS = 64
const MAX_POLL_MS = 30_000

export function createKafkaConnector(options: KafkaConnectorOptions = {}): ConnectorAdapter {
  const createClient = options.createClient ?? ((config) => new Kafka(config))

  return {
    manifest: {
      kind: 'kafka',
      displayName: 'Apache Kafka',
      description: 'Discover topics and groups, inspect offsets, produce records, and run bounded approved consumers over TLS.',
      auth: {
        kind: 'api-key',
        hint: 'JSON with brokers and optional SASL or mutual-TLS credentials. TLS is mandatory and broker addresses must resolve publicly.',
      },
      defaultConsistencyModel: 'advisory',
      category: 'webhook',
      rateLimit: { requests: 120, windowMs: 60_000, scope: 'data-source' },
      capabilities: [
        readCapability('kafka.topics.list', 'List Kafka topics visible to the connection.', emptySchema()),
        readCapability('kafka.topics.describe', 'Read partition and replica metadata for selected topics.', {
          type: 'object',
          properties: { topics: topicArraySchema() },
          required: ['topics'],
          additionalProperties: false,
        }),
        readCapability('kafka.offsets.list', 'Read low, high, and current offsets for one topic.', topicSchema()),
        readCapability('kafka.groups.list', 'List consumer groups visible to the connection.', emptySchema()),
        readCapability('kafka.group.offsets', 'Read committed offsets for a consumer group.', {
          type: 'object',
          properties: {
            groupId: { type: 'string', minLength: 1, maxLength: 255 },
            topics: topicArraySchema(),
          },
          required: ['groupId'],
          additionalProperties: false,
        }),
        mutationCapability('kafka.messages.produce', 'Produce one or more records with all acknowledgements enabled.', {
          type: 'object',
          properties: {
            topic: topicNameSchema(),
            encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
            messages: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_MESSAGES,
              items: {
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  key: { type: 'string' },
                  partition: { type: 'integer', minimum: 0 },
                  headers: { type: 'object', additionalProperties: { type: 'string' }, maxProperties: MAX_HEADERS },
                },
                required: ['value'],
                additionalProperties: false,
              },
            },
          },
          required: ['topic', 'messages'],
          additionalProperties: false,
        }),
        mutationCapability('kafka.messages.consume', 'Join a consumer group and return a bounded batch without automatically committing offsets.', {
          type: 'object',
          properties: {
            topic: topicNameSchema(),
            groupId: { type: 'string', minLength: 1, maxLength: 255 },
            encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
            fromBeginning: { type: 'boolean', default: false },
            limit: { type: 'integer', minimum: 1, maximum: MAX_MESSAGES, default: 25 },
            timeoutMs: { type: 'integer', minimum: 250, maximum: MAX_POLL_MS, default: 5_000 },
          },
          required: ['topic', 'groupId'],
          additionalProperties: false,
        }),
        mutationCapability('kafka.offsets.commit', 'Commit explicit next offsets for a consumer group.', {
          type: 'object',
          properties: {
            groupId: { type: 'string', minLength: 1, maxLength: 255 },
            offsets: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_MESSAGES,
              items: {
                type: 'object',
                properties: {
                  topic: topicNameSchema(),
                  partition: { type: 'integer', minimum: 0 },
                  offset: { type: 'string', pattern: '^[0-9]+$' },
                  metadata: { type: 'string', maxLength: 4096 },
                },
                required: ['topic', 'partition', 'offset'],
                additionalProperties: false,
              },
            },
          },
          required: ['groupId', 'offsets'],
          additionalProperties: false,
        }),
        mutationCapability('kafka.topics.create', 'Create one Kafka topic with explicit partition and replication counts.', {
          type: 'object',
          properties: {
            topic: topicNameSchema(),
            partitions: { type: 'integer', minimum: 1, maximum: 100, default: 1 },
            replicationFactor: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
          },
          required: ['topic'],
          additionalProperties: false,
        }),
        mutationCapability('kafka.topics.delete', 'Delete one or more Kafka topics.', {
          type: 'object',
          properties: { topics: topicArraySchema() },
          required: ['topics'],
          additionalProperties: false,
        }),
      ],
    },

    async executeRead({ source, capabilityName, args }) {
      const client = createClient(readCredentials(source).config)
      return withAdmin(client.admin(), async (admin) => {
        let data: unknown
        if (capabilityName === 'kafka.topics.list') {
          data = { topics: await admin.listTopics() }
        } else if (capabilityName === 'kafka.topics.describe') {
          data = await admin.fetchTopicMetadata({ topics: readTopics(args.topics) })
        } else if (capabilityName === 'kafka.offsets.list') {
          const topic = readTopic(args.topic)
          data = { topic, partitions: await admin.fetchTopicOffsets(topic) }
        } else if (capabilityName === 'kafka.groups.list') {
          data = await admin.listGroups()
        } else if (capabilityName === 'kafka.group.offsets') {
          const groupId = readGroupId(args.groupId)
          const topics = args.topics === undefined ? undefined : readTopics(args.topics)
          data = { groupId, offsets: await admin.fetchOffsets({ groupId, topics, resolveOffsets: true }) }
        } else {
          throw new Error(`Unknown Kafka read capability: ${capabilityName}`)
        }
        return { data: jsonSafe(data), fetchedAt: Date.now() }
      })
    },

    async executeMutation({ source, capabilityName, args }) {
      const client = createClient(readCredentials(source).config)
      let data: unknown
      if (capabilityName === 'kafka.messages.produce') {
        data = await produce(client.producer({ idempotent: true, maxInFlightRequests: 1 }), args)
      } else if (capabilityName === 'kafka.messages.consume') {
        data = await consume(client.consumer({
          groupId: readGroupId(args.groupId),
          allowAutoTopicCreation: false,
          maxBytes: MAX_BATCH_BYTES,
          maxBytesPerPartition: MAX_BATCH_BYTES,
        }), args)
      } else if (capabilityName === 'kafka.offsets.commit') {
        data = await commitOffsets(client.consumer({
          groupId: readGroupId(args.groupId),
          allowAutoTopicCreation: false,
        }), args)
      } else if (capabilityName === 'kafka.topics.create') {
        data = await withAdmin(client.admin(), async (admin) => ({
          created: await admin.createTopics({
            waitForLeaders: true,
            topics: [{
              topic: readTopic(args.topic),
              numPartitions: readBoundedInteger(args.partitions, 1, 1, 100, 'partitions'),
              replicationFactor: readBoundedInteger(args.replicationFactor, 1, 1, 10, 'replicationFactor'),
            }],
          }),
        }))
      } else if (capabilityName === 'kafka.topics.delete') {
        const topics = readTopics(args.topics)
        data = await withAdmin(client.admin(), async (admin) => {
          await admin.deleteTopics({ topics })
          return { topics }
        })
      } else {
        throw new Error(`Unknown Kafka mutation capability: ${capabilityName}`)
      }
      return {
        status: 'committed',
        data: jsonSafe(data),
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    },

    async test(source) {
      try {
        const admin = createClient(readCredentials(source).config).admin()
        await withAdmin(admin, (connected) => connected.listTopics())
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'Kafka connection test failed' }
      }
    },
  }
}

export const kafkaConnector = createKafkaConnector()

export const publicKafkaSocketFactory: ISocketFactory = ({ host, port, ssl, onConnect }) => {
  validateBrokerHost(host)
  if (isIP(host) !== 0 && !isPublicNetworkAddress(host)) {
    throw new Error('Kafka broker is not a public network target')
  }
  const socket = tls.connect({
    ...ssl,
    host,
    port,
    servername: isIP(host) === 0 ? host : undefined,
    lookup: publicDnsLookup,
  }, onConnect)
  socket.setKeepAlive(true, 60_000)
  return socket
}

async function withAdmin<T>(admin: Admin, run: (admin: Admin) => Promise<T>): Promise<T> {
  try {
    await admin.connect()
    return await run(admin)
  } finally {
    await admin.disconnect().catch(() => undefined)
  }
}

async function produce(producer: Producer, args: Record<string, unknown>): Promise<unknown> {
  const topic = readTopic(args.topic)
  const encoding = readEncoding(args.encoding)
  const messages = readMessageInputs(args.messages).map((message) => ({
    value: decodeMessageValue(message.value, encoding, 'value'),
    key: message.key === undefined ? undefined : decodeMessageValue(message.key, encoding, 'key'),
    partition: message.partition === undefined
      ? undefined
      : readBoundedInteger(message.partition, 0, 0, Number.MAX_SAFE_INTEGER, 'partition'),
    headers: readHeaders(message.headers),
  }))
  const batchBytes = messages.reduce((total, message) =>
    total + message.value.byteLength + (message.key?.byteLength ?? 0) + headerBytes(message.headers), 0)
  if (batchBytes > MAX_BATCH_BYTES) throw new Error(`messages exceed the ${MAX_BATCH_BYTES}-byte batch limit`)
  try {
    await producer.connect()
    return { topic, records: await producer.send({ topic, messages, acks: -1, timeout: 30_000 }) }
  } finally {
    await producer.disconnect().catch(() => undefined)
  }
}

async function consume(consumer: Consumer, args: Record<string, unknown>): Promise<unknown> {
  const topic = readTopic(args.topic)
  const encoding = readEncoding(args.encoding)
  const limit = readBoundedInteger(args.limit, 25, 1, MAX_MESSAGES, 'limit')
  const timeoutMs = readBoundedInteger(args.timeoutMs, 5_000, 250, MAX_POLL_MS, 'timeoutMs')
  const messages: unknown[] = []
  let batchBytes = 0
  let resolveDone: () => void = () => undefined
  let rejectDone: (error: unknown) => void = () => undefined
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await consumer.connect()
    await consumer.subscribe({ topics: [topic], fromBeginning: readBoolean(args.fromBeginning, false, 'fromBeginning') })
    const run = consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ partition, message }) => {
        if (messages.length >= limit) return
        const messageBytes = (message.key?.byteLength ?? 0) + (message.value?.byteLength ?? 0) + headerBytes(message.headers)
        if (messageBytes > MAX_MESSAGE_BYTES) throw new Error(`Kafka message exceeds the ${MAX_MESSAGE_BYTES}-byte limit`)
        batchBytes += messageBytes
        if (batchBytes > MAX_BATCH_BYTES) throw new Error(`Kafka batch exceeds the ${MAX_BATCH_BYTES}-byte limit`)
        messages.push({
          topic,
          partition,
          offset: message.offset,
          timestamp: message.timestamp,
          key: encodeMessageValue(message.key, encoding),
          value: encodeMessageValue(message.value, encoding),
          headers: Object.fromEntries(Object.entries(message.headers ?? {}).map(([key, value]) => [key, encodeHeader(value, encoding)])),
        })
        if (messages.length >= limit) resolveDone()
      },
    })
    run.catch(rejectDone)
    timer = setTimeout(resolveDone, timeoutMs)
    await done
    await consumer.stop()
    await run
    return { topic, messages, messageCount: messages.length, offsetsCommitted: false }
  } finally {
    if (timer) clearTimeout(timer)
    await consumer.disconnect().catch(() => undefined)
  }
}

async function commitOffsets(consumer: Consumer, args: Record<string, unknown>): Promise<unknown> {
  if (!Array.isArray(args.offsets) || args.offsets.length === 0 || args.offsets.length > MAX_MESSAGES) {
    throw new Error(`offsets must contain 1 through ${MAX_MESSAGES} entries`)
  }
  const offsets = args.offsets.map((entry, index) => {
    if (!isPlainRecord(entry)) throw new Error(`offsets[${index}] must be an object`)
    const offset = readOptionalString(entry.offset, `offsets[${index}].offset`)
    if (
      !offset ||
      !/^[0-9]+$/.test(offset) ||
      BigInt(offset) > 9_223_372_036_854_775_807n
    ) {
      throw new Error(`offsets[${index}].offset must be a signed 64-bit non-negative integer string`)
    }
    return {
      topic: readTopic(entry.topic),
      partition: readBoundedInteger(entry.partition, 0, 0, Number.MAX_SAFE_INTEGER, `offsets[${index}].partition`),
      offset,
      metadata: readOptionalString(entry.metadata, `offsets[${index}].metadata`),
    }
  })
  try {
    await consumer.connect()
    await consumer.commitOffsets(offsets)
    return { groupId: readGroupId(args.groupId), offsets }
  } finally {
    await consumer.disconnect().catch(() => undefined)
  }
}

function readCredentials(source: ResolvedDataSource): KafkaCredentials {
  let raw: unknown
  if (source.credentials.kind === 'custom') raw = source.credentials.values
  else if (source.credentials.kind === 'api-key') {
    try {
      raw = JSON.parse(source.credentials.apiKey)
    } catch {
      throw new Error('Kafka credential must be valid JSON')
    }
  } else {
    throw new Error('Kafka requires a structured credential bundle')
  }
  if (!isPlainRecord(raw)) throw new Error('Kafka credential must be a JSON object')
  const brokers = readBrokers(raw.brokers)
  const clientId = readOptionalString(raw.clientId, 'clientId') ?? 'tangle-integration-hub'
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(clientId)) throw new Error('clientId contains unsupported characters')
  const sasl = readSasl(raw)
  const ca = readPemList(raw.tlsCa, 'tlsCa')
  const cert = readOptionalString(raw.tlsCert, 'tlsCert')
  const key = readOptionalString(raw.tlsKey, 'tlsKey')
  if (Boolean(cert) !== Boolean(key)) throw new Error('tlsCert and tlsKey must be supplied together')
  return {
    config: {
      brokers,
      clientId,
      ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        ca,
        cert,
        key,
        passphrase: readOptionalString(raw.tlsPassphrase, 'tlsPassphrase'),
      },
      sasl,
      socketFactory: publicKafkaSocketFactory,
      connectionTimeout: 10_000,
      authenticationTimeout: 10_000,
      requestTimeout: 30_000,
      enforceRequestTimeout: true,
      retry: { retries: 3, maxRetryTime: 30_000 },
      logLevel: logLevel.NOTHING,
    },
  }
}

function readBrokers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error('brokers must contain 1 through 20 host:port entries')
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) throw new Error(`brokers[${index}] must be a host:port string`)
    let parsed: URL
    try {
      parsed = new URL(`tcp://${entry}`)
    } catch {
      throw new Error(`brokers[${index}] is not a valid host:port`)
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '')
    if (!parsed.port || parsed.username || parsed.password || !['', '/'].includes(parsed.pathname)) {
      throw new Error(`brokers[${index}] must contain only host and port`)
    }
    validateBrokerHost(host)
    if (isIP(host) !== 0 && !isPublicNetworkAddress(host)) throw new Error(`brokers[${index}] is not a public network target`)
    const port = Number(parsed.port)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`brokers[${index}] port is invalid`)
    return entry
  })
}

function validateBrokerHost(host: string): void {
  const normalized = host.toLowerCase()
  if (
    host.length === 0 ||
    host.length > 253 ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    /[\s/@]/.test(host)
  ) {
    throw new Error('Kafka broker must be a public hostname or IP address')
  }
}

function readSasl(raw: Record<string, unknown>): SASLOptions | undefined {
  if (raw.saslMechanism === undefined || raw.saslMechanism === null) return undefined
  if (!['plain', 'scram-sha-256', 'scram-sha-512'].includes(String(raw.saslMechanism))) {
    throw new Error('saslMechanism must be plain, scram-sha-256, or scram-sha-512')
  }
  const username = readOptionalString(raw.saslUsername, 'saslUsername')
  const password = readOptionalString(raw.saslPassword, 'saslPassword')
  if (!username || !password) throw new Error('SASL requires saslUsername and saslPassword')
  return { mechanism: raw.saslMechanism as 'plain' | 'scram-sha-256' | 'scram-sha-512', username, password }
}

function readPemList(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  const values = Array.isArray(value) ? value : [value]
  if (values.length === 0 || values.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error(`${label} must be a PEM string or non-empty array of PEM strings`)
  }
  return values as string[]
}

function readTopics(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TOPICS) {
    throw new Error(`topics must contain 1 through ${MAX_TOPICS} names`)
  }
  const topics = value.map(readTopic)
  if (new Set(topics).size !== topics.length) throw new Error('topics must not contain duplicates')
  return topics
}

function readTopic(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,249}$/.test(value) || value === '.' || value === '..') {
    throw new Error('topic must be 1 through 249 Kafka-safe characters')
  }
  return value
}

function readGroupId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255 || /[\u0000-\u001f]/.test(value)) {
    throw new Error('groupId must be 1 through 255 printable characters')
  }
  return value
}

function readEncoding(value: unknown): BufferEncoding {
  if (value === undefined || value === null || value === 'utf8') return 'utf8'
  if (value === 'base64') return 'base64'
  throw new Error('encoding must be utf8 or base64')
}

function readMessageInputs(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    throw new Error(`messages must contain 1 through ${MAX_MESSAGES} entries`)
  }
  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) throw new Error(`messages[${index}] must be an object`)
    return entry
  })
}

function decodeMessageValue(value: unknown, encoding: BufferEncoding, label: string): Buffer {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (encoding === 'base64' && (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))) {
    throw new Error(`${label} must be canonical base64`)
  }
  const decoded = Buffer.from(value, encoding)
  if (decoded.byteLength > MAX_MESSAGE_BYTES) throw new Error(`${label} exceeds the ${MAX_MESSAGE_BYTES}-byte limit`)
  return decoded
}

function encodeMessageValue(value: Buffer | null, encoding: BufferEncoding): string | null {
  return value ? value.toString(encoding) : null
}

function encodeHeader(value: Buffer | string | Array<Buffer | string> | undefined, encoding: BufferEncoding): unknown {
  if (value === undefined) return undefined
  if (Array.isArray(value)) return value.map((entry) => Buffer.isBuffer(entry) ? entry.toString(encoding) : entry)
  return Buffer.isBuffer(value) ? value.toString(encoding) : value
}

function readHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined
  if (!isPlainRecord(value) || Object.keys(value).length > MAX_HEADERS) throw new Error(`headers must have at most ${MAX_HEADERS} string fields`)
  const headers = Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (typeof entry !== 'string') throw new Error(`header ${key} must be a string`)
    return [key, entry]
  }))
  if (headerBytes(headers) > MAX_MESSAGE_BYTES) throw new Error(`headers exceed the ${MAX_MESSAGE_BYTES}-byte limit`)
  return headers
}

function headerBytes(headers: Record<string, unknown> | undefined): number {
  if (!headers) return 0
  return Object.entries(headers).reduce((total, [key, value]) => {
    const values = Array.isArray(value) ? value : [value]
    return total + Buffer.byteLength(key, 'utf8') + values.reduce((sum, entry) => {
      if (Buffer.isBuffer(entry)) return sum + entry.byteLength
      if (typeof entry === 'string') return sum + Buffer.byteLength(entry, 'utf8')
      return sum
    }, 0)
  }, 0)
}

function emptySchema(): Record<string, unknown> {
  return { type: 'object', properties: {}, additionalProperties: false }
}

function topicSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: { topic: topicNameSchema() },
    required: ['topic'],
    additionalProperties: false,
  }
}

function topicArraySchema(): Record<string, unknown> {
  return { type: 'array', minItems: 1, maxItems: MAX_TOPICS, items: topicNameSchema() }
}

function topicNameSchema(): Record<string, unknown> {
  return { type: 'string', minLength: 1, maxLength: 249, pattern: '^[A-Za-z0-9._-]+$' }
}

function readCapability(name: string, description: string, parameters: Record<string, unknown>) {
  return { name, class: 'read' as const, description, parameters }
}

function mutationCapability(name: string, description: string, parameters: Record<string, unknown>) {
  return { name, class: 'mutation' as const, description, parameters, cas: 'none' as const, externalEffect: true }
}
