import { createHmac } from 'node:crypto'
import {
  CredentialsExpired,
  ProviderConfigError,
  ProviderRateLimited,
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ConnectorInvocation,
} from '../types.js'

const MANAGEMENT_API_VERSION = '2017-04'
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_MESSAGE_BYTES = 256 * 1024
const SERVICE_BUS_SUFFIXES = [
  '.servicebus.windows.net',
  '.servicebus.usgovcloudapi.net',
  '.servicebus.chinacloudapi.cn',
  '.servicebus.cloudapi.de',
] as const

interface ServiceBusCredentials {
  endpoint: URL
  keyName: string
  key: Buffer
  entityPath?: string
}

interface ServiceBusResponse {
  response: Response
  body: Uint8Array
}

export const azureServiceBusConnector: ConnectorAdapter = {
  manifest: {
    kind: 'azure-service-bus',
    displayName: 'Azure Service Bus',
    description:
      'Send and receive Azure Service Bus queue and topic messages and discover queue, topic, and subscription entities with a customer-owned SAS connection string.',
    auth: {
      kind: 'api-key',
      hint: 'Azure Service Bus connection string containing Endpoint, SharedAccessKeyName, and SharedAccessKey. EntityPath is supported and restricts this connection to that queue or topic.',
    },
    category: 'webhook',
    // The REST receive-and-delete operation destructively consumes a message,
    // and message delivery is at-least-once. Acceptance is not proof that a
    // downstream consumer processed the payload exactly once.
    defaultConsistencyModel: 'advisory',
    rateLimit: { requests: 600, windowMs: 60_000, scope: 'data-source' },
    capabilities: [
      readCapability('queues.list', 'List queues visible to a namespace-level Manage policy.', listProperties()),
      readCapability('queues.get', 'Get one queue description and message counts.', {
        queue: { type: 'string' },
      }, ['queue']),
      readCapability('topics.list', 'List topics visible to a namespace-level Manage policy.', listProperties()),
      readCapability('topics.get', 'Get one topic description and message counts.', {
        topic: { type: 'string' },
      }, ['topic']),
      readCapability('subscriptions.list', 'List subscriptions for one topic.', {
        topic: { type: 'string' },
        ...listProperties(),
      }, ['topic']),
      readCapability('subscriptions.get', 'Get one topic subscription description and message counts.', {
        topic: { type: 'string' },
        subscription: { type: 'string' },
      }, ['topic', 'subscription']),
      mutationCapability('queues.send', 'Send a UTF-8 or base64 message to a queue.', sendProperties('queue'), ['queue', 'content']),
      mutationCapability('topics.send', 'Publish a UTF-8 or base64 message to a topic.', sendProperties('topic'), ['topic', 'content']),
      mutationCapability('queues.receiveDelete', 'Receive and permanently delete the next queue message.', {
        queue: { type: 'string' },
        timeoutSeconds: { type: 'integer', minimum: 0, maximum: 55 },
      }, ['queue']),
      mutationCapability('subscriptions.receiveDelete', 'Receive and permanently delete the next message from a topic subscription.', {
        topic: { type: 'string' },
        subscription: { type: 'string' },
        timeoutSeconds: { type: 'integer', minimum: 0, maximum: 55 },
      }, ['topic', 'subscription']),
      mutationCapability('queues.deadLetters.receiveDelete', 'Receive and permanently delete the next queue dead-letter message.', {
        queue: { type: 'string' },
        timeoutSeconds: { type: 'integer', minimum: 0, maximum: 55 },
      }, ['queue']),
      mutationCapability('subscriptions.deadLetters.receiveDelete', 'Receive and permanently delete the next subscription dead-letter message.', {
        topic: { type: 'string' },
        subscription: { type: 'string' },
        timeoutSeconds: { type: 'integer', minimum: 0, maximum: 55 },
      }, ['topic', 'subscription']),
    ],
  },

  async executeRead(inv): Promise<CapabilityReadResult> {
    const credentials = parseConnectionString(inv.source.credentials, inv.source.id)
    let path: string
    let list = false

    switch (inv.capabilityName) {
      case 'queues.list':
        requireNamespacePolicy(credentials, 'queues.list')
        path = '$Resources/Queues'
        list = true
        break
      case 'queues.get':
        path = entityName(inv.args.queue, 'queue')
        enforceEntityPath(credentials, path)
        break
      case 'topics.list':
        requireNamespacePolicy(credentials, 'topics.list')
        path = '$Resources/Topics'
        list = true
        break
      case 'topics.get':
        path = entityName(inv.args.topic, 'topic')
        enforceEntityPath(credentials, path)
        break
      case 'subscriptions.list': {
        const topic = entityName(inv.args.topic, 'topic')
        enforceEntityPath(credentials, topic)
        path = `${topic}/Subscriptions/`
        list = true
        break
      }
      case 'subscriptions.get': {
        const topic = entityName(inv.args.topic, 'topic')
        enforceEntityPath(credentials, topic)
        path = `${topic}/Subscriptions/${entityName(inv.args.subscription, 'subscription')}`
        break
      }
      default:
        throw new Error(`azure-service-bus: unknown read capability ${inv.capabilityName}`)
    }

    const query = list
      ? managementListQuery(inv.args)
      : new URLSearchParams({ 'api-version': MANAGEMENT_API_VERSION })
    const result = await serviceBusRequest(
      credentials,
      inv,
      'GET',
      path,
      query,
    )
    const xml = decodeUtf8(result.body)
    const data = list ? parseAtomFeed(xml) : parseAtomEntry(xml)
    return { data, fetchedAt: Date.now() }
  },

  async executeMutation(inv): Promise<CapabilityMutationResult> {
    const credentials = parseConnectionString(inv.source.credentials, inv.source.id)
    let data: unknown

    switch (inv.capabilityName) {
      case 'queues.send':
        data = await sendMessage(credentials, inv, entityName(inv.args.queue, 'queue'))
        break
      case 'topics.send':
        data = await sendMessage(credentials, inv, entityName(inv.args.topic, 'topic'))
        break
      case 'queues.receiveDelete':
        data = await receiveAndDelete(credentials, inv, entityName(inv.args.queue, 'queue'))
        break
      case 'subscriptions.receiveDelete':
        data = await receiveAndDelete(
          credentials,
          inv,
          `${entityName(inv.args.topic, 'topic')}/subscriptions/${entityName(inv.args.subscription, 'subscription')}`,
        )
        break
      case 'queues.deadLetters.receiveDelete':
        data = await receiveAndDelete(
          credentials,
          inv,
          `${entityName(inv.args.queue, 'queue')}/$DeadLetterQueue`,
        )
        break
      case 'subscriptions.deadLetters.receiveDelete':
        data = await receiveAndDelete(
          credentials,
          inv,
          `${entityName(inv.args.topic, 'topic')}/subscriptions/${entityName(inv.args.subscription, 'subscription')}/$DeadLetterQueue`,
        )
        break
      default:
        throw new Error(`azure-service-bus: unknown mutation capability ${inv.capabilityName}`)
    }

    return {
      status: 'committed',
      data,
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test(source) {
    try {
      parseConnectionString(source.credentials, source.id)
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'Azure Service Bus connection string is invalid' }
    }
  },
}

function readCapability(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
  }
}

function mutationCapability(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: { type: 'object', properties, required },
    cas: 'none' as const,
    externalEffect: true,
  }
}

function sendProperties(entity: 'queue' | 'topic'): Record<string, unknown> {
  return {
    [entity]: { type: 'string' },
    content: { type: 'string', description: 'UTF-8 text or canonical base64 message body.' },
    encoding: { type: 'string', enum: ['utf-8', 'base64'], default: 'utf-8' },
    contentType: { type: 'string' },
    brokerProperties: {
      type: 'object',
      description: 'Allowed broker properties such as MessageId, CorrelationId, Label, SessionId, TimeToLive, and ScheduledEnqueueTimeUtc.',
    },
    applicationProperties: {
      type: 'object',
      description: 'Application property headers with string, number, or boolean values.',
    },
  }
}

function listProperties(): Record<string, unknown> {
  return {
    skip: { type: 'integer', minimum: 0 },
    top: { type: 'integer', minimum: 1, maximum: 1000 },
  }
}

function managementListQuery(args: Record<string, unknown>): URLSearchParams {
  const query = new URLSearchParams({ 'api-version': MANAGEMENT_API_VERSION })
  if (args.skip !== undefined) query.set('$skip', String(boundedInteger(args.skip, 'skip', 0, 1_000_000)))
  if (args.top !== undefined) query.set('$top', String(boundedInteger(args.top, 'top', 1, 1000)))
  return query
}

function parseConnectionString(
  credentials: ConnectorCredentials,
  dataSourceId: string,
): ServiceBusCredentials {
  if (credentials.kind !== 'api-key') {
    throw new CredentialsExpired('Azure Service Bus requires a connection string', dataSourceId)
  }
  const values = new Map<string, string>()
  for (const part of credentials.apiKey.split(';')) {
    if (!part.trim()) continue
    const separator = part.indexOf('=')
    if (separator <= 0) {
      throw new CredentialsExpired('Azure Service Bus connection string is malformed', dataSourceId)
    }
    const name = part.slice(0, separator).trim().toLowerCase()
    if (values.has(name)) {
      throw new CredentialsExpired(`Azure Service Bus connection string repeats ${name}`, dataSourceId)
    }
    values.set(name, part.slice(separator + 1).trim())
  }
  const endpointValue = values.get('endpoint')
  const keyName = values.get('sharedaccesskeyname')
  const keyValue = values.get('sharedaccesskey')
  if (!endpointValue || !keyName || !keyValue) {
    throw new CredentialsExpired('Azure Service Bus connection string is missing Endpoint, SharedAccessKeyName, or SharedAccessKey', dataSourceId)
  }
  let endpoint: URL
  try {
    endpoint = new URL(endpointValue.replace(/^sb:/i, 'https:'))
  } catch {
    throw new CredentialsExpired('Azure Service Bus Endpoint is invalid', dataSourceId)
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/' ||
    !SERVICE_BUS_SUFFIXES.some((suffix) => endpoint.hostname.endsWith(suffix))
  ) {
    throw new CredentialsExpired('Azure Service Bus Endpoint must be a public Azure Service Bus namespace', dataSourceId)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(keyName)) {
    throw new CredentialsExpired('Azure Service Bus SharedAccessKeyName is invalid', dataSourceId)
  }
  let key: Buffer
  try {
    key = Buffer.from(keyValue, 'base64')
  } catch {
    throw new CredentialsExpired('Azure Service Bus SharedAccessKey is invalid base64', dataSourceId)
  }
  if (key.length < 16 || key.toString('base64').replace(/=+$/, '') !== keyValue.replace(/=+$/, '')) {
    throw new CredentialsExpired('Azure Service Bus SharedAccessKey is invalid base64', dataSourceId)
  }
  const entityPathValue = values.get('entitypath')
  const entityPath = entityPathValue ? entityName(entityPathValue, 'EntityPath') : undefined
  return { endpoint, keyName, key, entityPath }
}

async function sendMessage(
  credentials: ServiceBusCredentials,
  inv: ConnectorInvocation,
  entityPath: string,
): Promise<unknown> {
  enforceEntityPath(credentials, entityPath)
  const content = requiredString(inv.args.content, 'content', true)
  const encoding = inv.args.encoding === undefined
    ? 'utf-8'
    : enumValue(inv.args.encoding, 'encoding', ['utf-8', 'base64'])
  const body = encoding === 'base64' ? strictBase64(content) : Buffer.from(content, 'utf8')
  if (body.byteLength > MAX_MESSAGE_BYTES) {
    throw new Error(`Azure Service Bus message exceeds ${MAX_MESSAGE_BYTES} bytes`)
  }
  const headers: Record<string, string> = {
    'content-type': inv.args.contentType === undefined
      ? 'application/octet-stream'
      : requiredHeaderValue(inv.args.contentType, 'contentType'),
  }
  const brokerProperties = allowedBrokerProperties(inv.args.brokerProperties)
  if (brokerProperties) {
    const serializedBrokerProperties = JSON.stringify(brokerProperties)
    if (Buffer.byteLength(serializedBrokerProperties) > 16 * 1024) {
      throw new Error('brokerProperties exceeds 16384 bytes')
    }
    headers.BrokerProperties = serializedBrokerProperties
  }
  Object.assign(headers, applicationPropertyHeaders(inv.args.applicationProperties))
  const result = await serviceBusRequest(credentials, inv, 'POST', `${entityPath}/messages`, undefined, headers, body)
  return {
    accepted: true,
    entityPath,
    size: body.byteLength,
    location: result.response.headers.get('location') ?? undefined,
  }
}

async function receiveAndDelete(
  credentials: ServiceBusCredentials,
  inv: ConnectorInvocation,
  entityPath: string,
): Promise<unknown> {
  enforceEntityPath(credentials, entityPath)
  const timeoutSeconds = inv.args.timeoutSeconds === undefined
    ? 0
    : boundedInteger(inv.args.timeoutSeconds, 'timeoutSeconds', 0, 55)
  const result = await serviceBusRequest(
    credentials,
    inv,
    'DELETE',
    `${entityPath}/messages/head`,
    new URLSearchParams({ timeout: String(timeoutSeconds) }),
    undefined,
    undefined,
    [200, 204],
  )
  if (result.response.status === 204) return { message: null }
  const brokerPropertiesHeader = result.response.headers.get('brokerproperties')
  let brokerProperties: unknown
  if (brokerPropertiesHeader) {
    try {
      brokerProperties = JSON.parse(brokerPropertiesHeader)
    } catch {
      throw new Error('Azure Service Bus returned invalid BrokerProperties JSON')
    }
  }
  return {
    message: {
      body: Buffer.from(result.body).toString('base64'),
      encoding: 'base64',
      contentType: result.response.headers.get('content-type') ?? 'application/octet-stream',
      brokerProperties,
      applicationProperties: responseApplicationProperties(result.response.headers),
    },
  }
}

async function serviceBusRequest(
  credentials: ServiceBusCredentials,
  inv: ConnectorInvocation,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  query?: URLSearchParams,
  headers: Record<string, string> = {},
  body?: Uint8Array,
  acceptedStatuses: readonly number[] = [200, 201, 202, 204],
): Promise<ServiceBusResponse> {
  const url = new URL(path.split('/').map(encodePathSegment).join('/'), credentials.endpoint)
  if (query) url.search = query.toString()
  const resourceUri = `${url.origin}${url.pathname}`
  const expiry = Math.floor(Date.now() / 1000) + 300
  const encodedResourceUri = encodeURIComponent(resourceUri)
  const signature = createHmac('sha256', credentials.key)
    .update(`${encodedResourceUri}\n${expiry}`, 'utf8')
    .digest('base64')
  const authorization = `SharedAccessSignature sr=${encodedResourceUri}&sig=${encodeURIComponent(signature)}&se=${expiry}&skn=${encodeURIComponent(credentials.keyName)}`
  const response = await fetch(url, {
    method,
    headers: { authorization, accept: 'application/atom+xml, application/xml, */*', ...headers },
    body: body === undefined ? undefined : Uint8Array.from(body).buffer,
  })
  const responseBody = await readBounded(response, MAX_RESPONSE_BYTES)
  if (acceptedStatuses.includes(response.status)) return { response, body: responseBody }

  const text = decodeUtf8(responseBody)
  if (response.status === 401) {
    throw new CredentialsExpired('Azure Service Bus rejected the shared access signature', inv.source.id, {
      status: response.status,
      body: redactProviderText(text),
    })
  }
  if (response.status === 403) {
    throw new ProviderConfigError('Azure Service Bus policy lacks permission for this operation', inv.source.id, {
      status: response.status,
      body: redactProviderText(text),
    })
  }
  if (response.status === 429 || response.status === 503) {
    throw new ProviderRateLimited('Azure Service Bus is throttling requests', inv.source.id, {
      status: response.status,
      body: redactProviderText(text),
      retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
    })
  }
  throw new Error(`Azure Service Bus request failed with HTTP ${response.status}: ${redactProviderText(text).slice(0, 500)}`)
}

function encodePathSegment(segment: string): string {
  if (segment === '$Resources' || segment === '$DeadLetterQueue') return segment
  return encodeURIComponent(segment)
}

function entityName(value: unknown, field: string): string {
  const name = requiredString(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,259}$/.test(name)) {
    throw new Error(`${field} must be a valid Azure Service Bus entity name`)
  }
  return name
}

function requireNamespacePolicy(credentials: ServiceBusCredentials, capability: string): void {
  if (credentials.entityPath) {
    throw new Error(`${capability} requires a namespace-level connection string without EntityPath`)
  }
}

function enforceEntityPath(credentials: ServiceBusCredentials, requestedPath: string): void {
  if (!credentials.entityPath) return
  const normalized = requestedPath.toLowerCase()
  const allowed = credentials.entityPath.toLowerCase()
  if (
    normalized !== allowed &&
    normalized !== `${allowed}/$deadletterqueue` &&
    !normalized.startsWith(`${allowed}/subscriptions/`)
  ) {
    throw new Error(`Connection string EntityPath restricts access to ${credentials.entityPath}`)
  }
}

const BROKER_PROPERTY_NAMES = new Set([
  'CorrelationId',
  'SessionId',
  'Label',
  'MessageId',
  'ReplyTo',
  'ReplyToSessionId',
  'To',
  'TimeToLive',
  'ScheduledEnqueueTimeUtc',
  'PartitionKey',
  'ViaPartitionKey',
  'ForcePersistence',
])

function allowedBrokerProperties(value: unknown): Record<string, string | number | boolean> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('brokerProperties must be an object')
  const entries = Object.entries(value)
  if (entries.length > BROKER_PROPERTY_NAMES.size) throw new Error('brokerProperties contains too many fields')
  const result: Record<string, string | number | boolean> = {}
  for (const [key, property] of entries) {
    if (!BROKER_PROPERTY_NAMES.has(key)) throw new Error(`brokerProperties.${key} is not allowed`)
    if (!['string', 'number', 'boolean'].includes(typeof property) || !Number.isFinite(typeof property === 'number' ? property : 0)) {
      throw new Error(`brokerProperties.${key} must be a finite string, number, or boolean`)
    }
    if (typeof property === 'string') requiredHeaderValue(property, `brokerProperties.${key}`)
    result[key] = property as string | number | boolean
  }
  return result
}

const RESERVED_HEADERS = new Set([
  'authorization',
  'brokerproperties',
  'content-length',
  'content-type',
  'host',
])

function applicationPropertyHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('applicationProperties must be an object')
  const entries = Object.entries(value)
  if (entries.length > 64) throw new Error('applicationProperties cannot contain more than 64 entries')
  const result: Record<string, string> = {}
  let size = 0
  for (const [key, property] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(key) || RESERVED_HEADERS.has(key.toLowerCase()) || key.toLowerCase().startsWith('x-ms-')) {
      throw new Error(`applicationProperties.${key} is not a safe header name`)
    }
    if (!['string', 'number', 'boolean'].includes(typeof property)) {
      throw new Error(`applicationProperties.${key} must be a string, number, or boolean`)
    }
    if (typeof property === 'number' && !Number.isFinite(property)) {
      throw new Error(`applicationProperties.${key} must be finite`)
    }
    const headerValue = requiredHeaderValue(String(property), `applicationProperties.${key}`)
    size += Buffer.byteLength(key) + Buffer.byteLength(headerValue)
    if (size > 32 * 1024) throw new Error('applicationProperties exceeds 32768 bytes')
    result[key] = headerValue
  }
  return result
}

function responseApplicationProperties(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of headers.entries()) {
    if (
      !RESERVED_HEADERS.has(key.toLowerCase()) &&
      !key.toLowerCase().startsWith('x-ms-') &&
      key.toLowerCase() !== 'date' &&
      key.toLowerCase() !== 'server' &&
      key.toLowerCase() !== 'transfer-encoding'
    ) result[key] = value
  }
  return result
}

function parseAtomFeed(xml: string): { entries: unknown[]; nextLink?: string } {
  const nextLink = xml.match(/<link\b(?=[^>]*\brel=["']next["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*\/?>/i)?.[1]
  return {
    entries: [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => parseAtomEntry(match[0])),
    ...(nextLink ? { nextLink: decodeXml(nextLink) } : {}),
  }
}

function parseAtomEntry(xml: string): Record<string, unknown> {
  const title = xmlValue(xml, 'title')
  const id = xmlValue(xml, 'id')
  const updated = xmlValue(xml, 'updated')
  const properties: Record<string, string | number | boolean> = {}
  for (const match of xml.matchAll(/<(?:[A-Za-z0-9]+:)?([A-Za-z][A-Za-z0-9]*)\b[^>]*>([^<]*)<\/(?:[A-Za-z0-9]+:)?\1>/g)) {
    const key = match[1]!
    if (['title', 'id', 'updated'].includes(key.toLowerCase())) continue
    const raw = decodeXml(match[2]!)
    properties[key] = xmlScalar(raw)
  }
  return { title, id, updated, properties }
}

function xmlValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<(?:[A-Za-z0-9]+:)?${tag}\\b[^>]*>([^<]*)<\\/(?:[A-Za-z0-9]+:)?${tag}>`, 'i'))
  return match ? decodeXml(match[1]!) : undefined
}

function xmlScalar(value: string): string | number | boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return value
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new Error(`Azure Service Bus response exceeds ${limit} bytes`)
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error(`Azure Service Bus response exceeds ${limit} bytes`)
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function strictBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('content must be canonical base64 when encoding=base64')
  }
  return Buffer.from(value, 'base64')
}

function requiredString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new Error(`${field} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`)
  }
  return allowEmpty ? value : value.trim()
}

function requiredHeaderValue(value: unknown, field: string): string {
  const parsed = requiredString(value, field)
  if (/\r|\n/.test(parsed) || parsed.length > 4096) throw new Error(`${field} is not a safe header value`)
  return parsed
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function enumValue<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new Error(`${field} must be one of ${choices.join(', ')}`)
  }
  return value as T
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(value)
}

function retryAfterMs(value: string | null): number {
  if (!value) return 60_000
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 60_000
}

function redactProviderText(value: string): string {
  return value
    .replace(/SharedAccessSignature\s+[^\s<]+/gi, 'SharedAccessSignature [redacted]')
    .replace(/SharedAccessKey=[^;\s<]+/gi, 'SharedAccessKey=[redacted]')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
