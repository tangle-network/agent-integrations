import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import {
  connect as amqpConnect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type Message,
  type Options,
  type SocketOptions,
} from 'amqplib'
import type { ConnectorAdapter, ResolvedDataSource } from '../types.js'
import { isPlainRecord, readBoolean, readBoundedInteger, readOptionalString } from './file-payload.js'
import { isPublicNetworkAddress, publicDnsLookup, resolvePublicHostAddresses } from './public-network.js'

const MAX_MESSAGE_BYTES = 1024 * 1024
const MAX_NAME_BYTES = 255
const MAX_PEM_BYTES = 64 * 1024
const MAX_CA_CERTIFICATES = 16
const MAX_CA_BYTES = 256 * 1024

type ConnectRabbitMq = (options: Options.Connect, socketOptions?: SocketOptions) => Promise<ChannelModel>

export interface RabbitMqConnectorOptions {
  connect?: ConnectRabbitMq
  resolveHost?: (host: string) => Promise<string[]>
}

interface RabbitMqCredentials {
  host: string
  connectOptions: Options.Connect
  socketOptions: SocketOptions
  secrets: string[]
}

export function createRabbitMqConnector(options: RabbitMqConnectorOptions = {}): ConnectorAdapter {
  const connect = options.connect ?? ((connectOptions, socketOptions) => amqpConnect(connectOptions, socketOptions))
  const resolveHost = options.resolveHost ?? resolvePublicHostAddresses

  return {
    manifest: {
      kind: 'rabbitmq',
      displayName: 'RabbitMQ',
      description: 'Inspect queues and exchanges and publish confirmed JSON messages over verified TLS.',
      auth: {
        kind: 'api-key',
        hint: 'JSON with a public RabbitMQ host, username, password, virtual host, and optional TLS client credentials.',
      },
      defaultConsistencyModel: 'advisory',
      category: 'webhook',
      rateLimit: { requests: 120, windowMs: 60_000, scope: 'data-source' },
      capabilities: [
        readCapability('rabbitmq.queues.inspect', 'Check a queue and return its current message and consumer counts.', {
          type: 'object',
          properties: { queue: nameSchema('queue') },
          required: ['queue'],
          additionalProperties: false,
        }),
        readCapability('rabbitmq.exchanges.inspect', 'Check whether a named exchange exists and is visible to the connection.', {
          type: 'object',
          properties: { exchange: nameSchema('exchange') },
          required: ['exchange'],
          additionalProperties: false,
        }),
        mutationCapability('send.message.to.queue', 'Publish a persistent JSON message directly to an existing queue with broker confirmation.', {
          type: 'object',
          properties: {
            queue: nameSchema('queue'),
            data: {},
            persistent: { type: 'boolean', default: true },
            expirationMs: { type: 'integer', minimum: 1, maximum: 604_800_000 },
            priority: { type: 'integer', minimum: 0, maximum: 255 },
          },
          required: ['queue', 'data'],
          additionalProperties: false,
        }),
        mutationCapability('send.message.to.exchange', 'Publish a persistent JSON message to an existing exchange with broker confirmation.', {
          type: 'object',
          properties: {
            exchange: nameSchema('exchange'),
            routingKey: { type: 'string', maxLength: MAX_NAME_BYTES, default: '' },
            data: {},
            persistent: { type: 'boolean', default: true },
            expirationMs: { type: 'integer', minimum: 1, maximum: 604_800_000 },
            priority: { type: 'integer', minimum: 0, maximum: 255 },
          },
          required: ['exchange', 'data'],
          additionalProperties: false,
        }),
      ],
    },

    async executeRead({ source, capabilityName, args }) {
      if (capabilityName === 'rabbitmq.queues.inspect') {
        const queue = readName(args.queue, 'queue')
        const data = await withChannel(source, connect, resolveHost, async (channel) => {
          const details = await channel.checkQueue(queue)
          return { queue: details.queue, messageCount: details.messageCount, consumerCount: details.consumerCount }
        })
        return { data, fetchedAt: Date.now() }
      }
      if (capabilityName === 'rabbitmq.exchanges.inspect') {
        const exchange = readName(args.exchange, 'exchange')
        const data = await withChannel(source, connect, resolveHost, async (channel) => {
          await channel.checkExchange(exchange)
          return { exchange, exists: true }
        })
        return { data, fetchedAt: Date.now() }
      }
      throw new Error(`Unknown RabbitMQ read capability: ${capabilityName}`)
    },

    async executeMutation({ source, capabilityName, args, idempotencyKey }) {
      let data: unknown
      if (capabilityName === 'send.message.to.queue') {
        const queue = readName(args.queue, 'queue')
        const body = readJsonMessage(args.data)
        const publishOptions = readPublishOptions(args, idempotencyKey)
        data = await withConfirmChannel(source, connect, resolveHost, async (channel) => {
          await channel.checkQueue(queue)
          await publishConfirmed(channel, publishOptions, (options) => channel.sendToQueue(queue, body, options))
          return { queue, confirmed: true, messageId: publishOptions.messageId, byteLength: body.byteLength }
        })
      } else if (capabilityName === 'send.message.to.exchange') {
        const exchange = readName(args.exchange, 'exchange')
        const routingKey = readRoutingKey(args.routingKey)
        const body = readJsonMessage(args.data)
        const publishOptions = readPublishOptions(args, idempotencyKey)
        data = await withConfirmChannel(source, connect, resolveHost, async (channel) => {
          await channel.checkExchange(exchange)
          await publishConfirmed(channel, publishOptions, (options) => channel.publish(exchange, routingKey, body, options))
          return { exchange, routingKey, confirmed: true, messageId: publishOptions.messageId, byteLength: body.byteLength }
        })
      } else {
        throw new Error(`Unknown RabbitMQ mutation capability: ${capabilityName}`)
      }
      return { status: 'committed', data, committedAt: Date.now(), idempotentReplay: false }
    },

    async test(source) {
      try {
        const credentials = readCredentials(source)
        await resolveHost(credentials.host)
        const model = await connect(credentials.connectOptions, credentials.socketOptions)
        await model.close()
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: safeErrorMessage(error, credentialSecrets(source)) }
      }
    },
  }
}

export const rabbitMqConnector = createRabbitMqConnector()

async function withChannel<T>(
  source: ResolvedDataSource,
  connect: ConnectRabbitMq,
  resolveHost: (host: string) => Promise<string[]>,
  run: (channel: Channel) => Promise<T>,
): Promise<T> {
  const credentials = readCredentials(source)
  await resolveHost(credentials.host)
  let model: ChannelModel | undefined
  let channel: Channel | undefined
  try {
    model = await connect(credentials.connectOptions, credentials.socketOptions)
    channel = await model.createChannel()
    return await run(channel)
  } catch (error) {
    throw new Error(safeErrorMessage(error, credentials.secrets))
  } finally {
    await channel?.close().catch(() => undefined)
    await model?.close().catch(() => undefined)
  }
}

async function withConfirmChannel<T>(
  source: ResolvedDataSource,
  connect: ConnectRabbitMq,
  resolveHost: (host: string) => Promise<string[]>,
  run: (channel: ConfirmChannel) => Promise<T>,
): Promise<T> {
  const credentials = readCredentials(source)
  await resolveHost(credentials.host)
  let model: ChannelModel | undefined
  let channel: ConfirmChannel | undefined
  try {
    model = await connect(credentials.connectOptions, credentials.socketOptions)
    channel = await model.createConfirmChannel()
    return await run(channel)
  } catch (error) {
    throw new Error(safeErrorMessage(error, credentials.secrets))
  } finally {
    await channel?.close().catch(() => undefined)
    await model?.close().catch(() => undefined)
  }
}

async function publishConfirmed(
  channel: ConfirmChannel,
  publishOptions: Options.Publish,
  publish: (options: Options.Publish) => boolean,
): Promise<void> {
  let returned: Message | undefined
  const onReturn = (message: Message) => { returned = message }
  channel.on('return', onReturn)
  try {
    publish(publishOptions)
    await channel.waitForConfirms()
    if (returned) throw new Error('RabbitMQ accepted but could not route the message')
  } finally {
    channel.removeListener('return', onReturn)
  }
}

function readCredentials(source: ResolvedDataSource): RabbitMqCredentials {
  let raw: unknown
  if (source.credentials.kind === 'custom') raw = source.credentials.values
  else if (source.credentials.kind === 'api-key') {
    try {
      raw = JSON.parse(source.credentials.apiKey)
    } catch {
      throw new Error('RabbitMQ credential must be valid JSON')
    }
  } else {
    throw new Error('RabbitMQ requires a structured credential bundle')
  }
  if (!isPlainRecord(raw)) throw new Error('RabbitMQ credential must be a JSON object')
  const host = readHost(raw.host)
  const port = readBoundedInteger(raw.port, 5671, 1, 65_535, 'port')
  const username = readRequiredString(raw.username, 'username', 1_024)
  const password = readRequiredString(raw.password, 'password', 4_096)
  const vhost = readOptionalString(raw.vhost, 'vhost') ?? '/'
  if (Buffer.byteLength(vhost, 'utf8') > MAX_NAME_BYTES || /[\u0000-\u001f\u007f]/.test(vhost)) {
    throw new Error(`vhost must be at most ${MAX_NAME_BYTES} bytes without control characters`)
  }
  const ca = readPem(raw.tlsCa, 'tlsCa', true)
  const cert = readPem(raw.tlsCert, 'tlsCert', false)
  const key = readPem(raw.tlsKey, 'tlsKey', false)
  if (Boolean(cert) !== Boolean(key)) throw new Error('tlsCert and tlsKey must be supplied together')
  const passphrase = readOptionalString(raw.tlsPassphrase, 'tlsPassphrase')
  return {
    host,
    connectOptions: {
      protocol: 'amqps',
      hostname: host,
      port,
      username,
      password,
      vhost,
      heartbeat: readBoundedInteger(raw.heartbeatSeconds, 30, 5, 300, 'heartbeatSeconds'),
      frameMax: MAX_MESSAGE_BYTES + 4_096,
    },
    socketOptions: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      servername: isIP(host) === 0 ? host : undefined,
      lookup: publicDnsLookup,
      timeout: readBoundedInteger(raw.connectionTimeoutMs, 10_000, 1_000, 30_000, 'connectionTimeoutMs'),
      noDelay: true,
      keepAlive: true,
      keepAliveDelay: 60_000,
      ca,
      cert,
      key,
      passphrase,
    },
    secrets: [password, ...(cert ? [cert] : []), ...(key ? [key] : []), ...(passphrase ? [passphrase] : [])],
  }
}

function readHost(value: unknown): string {
  const host = readRequiredString(value, 'host', 253)
  const ipVersion = isIP(host)
  if (ipVersion !== 0) {
    if (!isPublicNetworkAddress(host)) throw new Error('RabbitMQ host is not a public network target')
    return host
  }
  const normalized = host.toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    /[\s/@:\[\]]/.test(host)
  ) {
    throw new Error('RabbitMQ host must be a public hostname or IP address without a scheme or port')
  }
  return host
}

function readPublishOptions(args: Record<string, unknown>, idempotencyKey: string): Options.Publish {
  const expirationMs = args.expirationMs === undefined
    ? undefined
    : readBoundedInteger(args.expirationMs, 0, 1, 604_800_000, 'expirationMs')
  const priority = args.priority === undefined
    ? undefined
    : readBoundedInteger(args.priority, 0, 0, 255, 'priority')
  return {
    mandatory: true,
    persistent: readBoolean(args.persistent, true, 'persistent'),
    contentType: 'application/json',
    contentEncoding: 'utf-8',
    messageId: createHash('sha256').update(idempotencyKey).digest('hex'),
    timestamp: Math.floor(Date.now() / 1_000),
    appId: 'tangle-integration-hub',
    expiration: expirationMs === undefined ? undefined : String(expirationMs),
    priority,
  }
}

function readJsonMessage(value: unknown): Buffer {
  if (value === undefined) throw new Error('data is required')
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('data must be JSON-serializable')
  }
  if (serialized === undefined) throw new Error('data must be JSON-serializable')
  const body = Buffer.from(serialized)
  if (body.byteLength > MAX_MESSAGE_BYTES) throw new Error(`data exceeds the ${MAX_MESSAGE_BYTES}-byte limit`)
  return body
}

function readName(value: unknown, label: string): string {
  const name = readRequiredString(value, label, MAX_NAME_BYTES)
  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error(`${label} must be at most ${MAX_NAME_BYTES} bytes without control characters`)
  }
  return name
}

function readRoutingKey(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  return readName(value, 'routingKey')
}

function readRequiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters`)
  }
  return value
}

function readPem(value: unknown, label: string, allowArray: true): string[] | undefined
function readPem(value: unknown, label: string, allowArray: false): string | undefined
function readPem(value: unknown, label: string, allowArray: boolean): string | string[] | undefined {
  if (value === undefined || value === null) return undefined
  const values = Array.isArray(value) && allowArray ? value : [value]
  if (
    values.length === 0 ||
    values.length > MAX_CA_CERTIFICATES ||
    values.some((entry) => typeof entry !== 'string' || entry.length === 0 || Buffer.byteLength(entry, 'utf8') > MAX_PEM_BYTES) ||
    values.reduce((total, entry) => total + (typeof entry === 'string' ? Buffer.byteLength(entry, 'utf8') : 0), 0) > MAX_CA_BYTES
  ) {
    throw new Error(
      allowArray
        ? `${label} must contain 1-${MAX_CA_CERTIFICATES} PEM strings, each under ${MAX_PEM_BYTES} bytes and ${MAX_CA_BYTES} bytes total`
        : `${label} must be a PEM string under ${MAX_PEM_BYTES} bytes`,
    )
  }
  return allowArray ? values as string[] : values[0] as string
}

function credentialSecrets(source: ResolvedDataSource): string[] {
  try {
    return readCredentials(source).secrets
  } catch {
    return []
  }
}

function safeErrorMessage(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) {
    if (secret.length >= 4) message = message.replaceAll(secret, '[REDACTED]')
  }
  return message
}

function readCapability(name: string, description: string, parameters: Record<string, unknown>) {
  return { name, class: 'read' as const, description, parameters }
}

function mutationCapability(name: string, description: string, parameters: Record<string, unknown>) {
  return { name, class: 'mutation' as const, description, parameters, cas: 'none' as const, externalEffect: true }
}

function nameSchema(label: string) {
  return { type: 'string', minLength: 1, maxLength: MAX_NAME_BYTES, description: `Existing RabbitMQ ${label} name.` }
}
