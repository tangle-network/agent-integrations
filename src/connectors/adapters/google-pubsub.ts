import { createHash, createSign } from 'node:crypto'
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

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_ROOT = 'https://pubsub.googleapis.com/v1'
const PUBSUB_SCOPE = 'https://www.googleapis.com/auth/pubsub'
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_REQUEST_BYTES = 10_000_000
const MAX_TOKEN_CACHE_ENTRIES = 256

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()
const tokenExchanges = new Map<string, Promise<string>>()

interface ServiceAccountCredentials {
  projectId: string
  clientEmail: string
  privateKey: string
}

export const googlePubSubConnector: ConnectorAdapter = {
  manifest: {
    kind: 'gcloud-pubsub',
    displayName: 'Google Cloud Pub/Sub',
    description:
      'Publish and pull Google Cloud Pub/Sub messages and manage topics and subscriptions with a customer-owned service account.',
    auth: {
      kind: 'api-key',
      hint: 'Google Cloud service-account key JSON. Enable the Pub/Sub API and grant only the topic, subscription, publisher, or subscriber roles required by approved workflows.',
    },
    category: 'webhook',
    // Pub/Sub is at-least-once. Publish acceptance and pull delivery do not
    // prove exactly-once processing, so callers must not treat results as an
    // authoritative record of downstream delivery.
    defaultConsistencyModel: 'advisory',
    rateLimit: { requests: 600, windowMs: 60_000, scope: 'data-source' },
    capabilities: [
      readCapability('topics.list', 'List topics in the service account project.', {
        pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
        pageToken: { type: 'string' },
      }),
      readCapability('topics.get', 'Get one topic and its server-side configuration.', {
        topic: { type: 'string', description: 'Topic ID in the service account project.' },
      }, ['topic']),
      mutationCapability('topics.create', 'Create a topic in the service account project.', {
        topic: { type: 'string' },
        labels: { type: 'object', additionalProperties: { type: 'string' } },
        allowedPersistenceRegions: { type: 'array', items: { type: 'string' } },
        kmsKeyName: { type: 'string' },
        schema: { type: 'string', description: 'Full Pub/Sub schema resource name.' },
        schemaEncoding: { type: 'string', enum: ['JSON', 'BINARY'] },
      }, ['topic']),
      mutationCapability('topics.delete', 'Delete a topic. Existing subscriptions remain but stop receiving messages.', {
        topic: { type: 'string' },
      }, ['topic']),
      mutationCapability('messages.publish', 'Publish up to 1,000 messages to a topic.', {
        topic: { type: 'string' },
        messages: {
          type: 'array',
          minItems: 1,
          maxItems: 1000,
          description:
            'Messages with either text (UTF-8) or data (base64), plus optional string attributes and orderingKey.',
        },
      }, ['topic', 'messages']),
      readCapability('subscriptions.list', 'List subscriptions in the service account project.', {
        pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
        pageToken: { type: 'string' },
      }),
      readCapability('subscriptions.get', 'Get one subscription and its delivery configuration.', {
        subscription: { type: 'string' },
      }, ['subscription']),
      mutationCapability('subscriptions.create', 'Create a pull subscription for a topic.', {
        subscription: { type: 'string' },
        topic: { type: 'string' },
        ackDeadlineSeconds: { type: 'integer', minimum: 10, maximum: 600 },
        retainAckedMessages: { type: 'boolean' },
        messageRetentionDuration: { type: 'string', description: 'Protobuf duration such as 604800s.' },
        expirationTtl: { type: 'string', description: 'Subscription expiry TTL such as 2678400s.' },
        filter: { type: 'string' },
        deadLetterTopic: { type: 'string' },
        maxDeliveryAttempts: { type: 'integer', minimum: 5, maximum: 100 },
        minimumBackoff: { type: 'string' },
        maximumBackoff: { type: 'string' },
        enableMessageOrdering: { type: 'boolean' },
        enableExactlyOnceDelivery: { type: 'boolean' },
        labels: { type: 'object', additionalProperties: { type: 'string' } },
      }, ['subscription', 'topic']),
      mutationCapability('subscriptions.delete', 'Delete a subscription and discard its retained messages.', {
        subscription: { type: 'string' },
      }, ['subscription']),
      mutationCapability('messages.pull', 'Pull messages and make them temporarily unavailable to other subscribers.', {
        subscription: { type: 'string' },
        maxMessages: { type: 'integer', minimum: 1, maximum: 1000 },
      }, ['subscription', 'maxMessages']),
      mutationCapability('messages.acknowledge', 'Acknowledge delivered messages by ack ID.', {
        subscription: { type: 'string' },
        ackIds: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'string' } },
      }, ['subscription', 'ackIds']),
      mutationCapability('messages.modifyAckDeadline', 'Change the acknowledgement deadline for delivered messages.', {
        subscription: { type: 'string' },
        ackIds: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'string' } },
        ackDeadlineSeconds: { type: 'integer', minimum: 0, maximum: 600 },
      }, ['subscription', 'ackIds', 'ackDeadlineSeconds']),
    ],
  },

  async executeRead(inv): Promise<CapabilityReadResult> {
    const credentials = parseServiceAccountCredentials(inv.source.credentials, inv.source.id)
    let data: unknown

    switch (inv.capabilityName) {
      case 'topics.list':
        data = await pubSubRequest(credentials, inv, 'GET', projectPath(credentials, 'topics'), pagination(inv.args))
        break
      case 'topics.get':
        data = await pubSubRequest(credentials, inv, 'GET', topicPath(credentials, inv.args.topic))
        break
      case 'subscriptions.list':
        data = await pubSubRequest(credentials, inv, 'GET', projectPath(credentials, 'subscriptions'), pagination(inv.args))
        break
      case 'subscriptions.get':
        data = await pubSubRequest(credentials, inv, 'GET', subscriptionPath(credentials, inv.args.subscription))
        break
      default:
        throw new Error(`gcloud-pubsub: unknown read capability ${inv.capabilityName}`)
    }

    return { data, fetchedAt: Date.now() }
  },

  async executeMutation(inv): Promise<CapabilityMutationResult> {
    const credentials = parseServiceAccountCredentials(inv.source.credentials, inv.source.id)
    let data: unknown

    switch (inv.capabilityName) {
      case 'topics.create': {
        const body: Record<string, unknown> = {}
        const labels = optionalStringMap(inv.args.labels, 'labels')
        if (labels) body.labels = labels
        const regions = optionalStringArray(inv.args.allowedPersistenceRegions, 'allowedPersistenceRegions')
        if (regions) body.messageStoragePolicy = { allowedPersistenceRegions: regions }
        if (inv.args.kmsKeyName !== undefined) body.kmsKeyName = requiredString(inv.args.kmsKeyName, 'kmsKeyName')
        if (inv.args.schema !== undefined) {
          body.schemaSettings = {
            schema: requiredString(inv.args.schema, 'schema'),
            ...(inv.args.schemaEncoding === undefined
              ? {}
              : { encoding: enumValue(inv.args.schemaEncoding, 'schemaEncoding', ['JSON', 'BINARY']) }),
          }
        }
        data = await pubSubRequest(credentials, inv, 'PUT', topicPath(credentials, inv.args.topic), undefined, body)
        break
      }
      case 'topics.delete':
        data = await pubSubRequest(credentials, inv, 'DELETE', topicPath(credentials, inv.args.topic))
        break
      case 'messages.publish':
        data = await pubSubRequest(
          credentials,
          inv,
          'POST',
          `${topicPath(credentials, inv.args.topic)}:publish`,
          undefined,
          { messages: publishMessages(inv.args.messages) },
        )
        break
      case 'subscriptions.create':
        data = await pubSubRequest(
          credentials,
          inv,
          'PUT',
          subscriptionPath(credentials, inv.args.subscription),
          undefined,
          subscriptionBody(credentials, inv.args),
        )
        break
      case 'subscriptions.delete':
        data = await pubSubRequest(credentials, inv, 'DELETE', subscriptionPath(credentials, inv.args.subscription))
        break
      case 'messages.pull':
        data = await pubSubRequest(
          credentials,
          inv,
          'POST',
          `${subscriptionPath(credentials, inv.args.subscription)}:pull`,
          undefined,
          { maxMessages: boundedInteger(inv.args.maxMessages, 'maxMessages', 1, 1000) },
        )
        break
      case 'messages.acknowledge':
        data = await pubSubRequest(
          credentials,
          inv,
          'POST',
          `${subscriptionPath(credentials, inv.args.subscription)}:acknowledge`,
          undefined,
          { ackIds: requiredStringArray(inv.args.ackIds, 'ackIds', 1000) },
        )
        break
      case 'messages.modifyAckDeadline':
        data = await pubSubRequest(
          credentials,
          inv,
          'POST',
          `${subscriptionPath(credentials, inv.args.subscription)}:modifyAckDeadline`,
          undefined,
          {
            ackIds: requiredStringArray(inv.args.ackIds, 'ackIds', 1000),
            ackDeadlineSeconds: boundedInteger(inv.args.ackDeadlineSeconds, 'ackDeadlineSeconds', 0, 600),
          },
        )
        break
      default:
        throw new Error(`gcloud-pubsub: unknown mutation capability ${inv.capabilityName}`)
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
      const credentials = parseServiceAccountCredentials(source.credentials, source.id)
      await pubSubRequest(credentials, {
        source,
        capabilityName: 'topics.list',
        args: {},
        idempotencyKey: 'connection-test',
      }, 'GET', projectPath(credentials, 'topics'), new URLSearchParams({ pageSize: '1' }))
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'Google Pub/Sub connection failed' }
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

function parseServiceAccountCredentials(
  credentials: ConnectorCredentials,
  dataSourceId: string,
): ServiceAccountCredentials {
  if (credentials.kind !== 'api-key') {
    throw new CredentialsExpired('Google Pub/Sub requires service-account key JSON', dataSourceId)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(credentials.apiKey)
  } catch {
    throw new CredentialsExpired('Google Pub/Sub service-account key must be valid JSON', dataSourceId)
  }
  if (!isRecord(parsed) || parsed.type !== 'service_account') {
    throw new CredentialsExpired('Google Pub/Sub requires a Google service_account key', dataSourceId)
  }
  const projectId = requiredCredentialString(parsed.project_id, 'project_id', dataSourceId)
  const clientEmail = requiredCredentialString(parsed.client_email, 'client_email', dataSourceId)
  const privateKey = requiredCredentialString(parsed.private_key, 'private_key', dataSourceId)
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/.test(clientEmail)) {
    throw new CredentialsExpired('Google Pub/Sub client_email is not a service-account address', dataSourceId)
  }
  if (!/^[a-z][a-z0-9.:-]{4,127}$/.test(projectId) || projectId.includes('..')) {
    throw new CredentialsExpired('Google Pub/Sub project_id is invalid', dataSourceId)
  }
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || privateKey.length > 20_000) {
    throw new CredentialsExpired('Google Pub/Sub private_key is not a valid PKCS#8 key', dataSourceId)
  }
  return { projectId, clientEmail, privateKey }
}

async function accessToken(credentials: ServiceAccountCredentials, dataSourceId: string): Promise<string> {
  const cacheKey = createHash('sha256')
    .update(credentials.clientEmail)
    .update('\0')
    .update(credentials.privateKey)
    .digest('hex')
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    tokenCache.delete(cacheKey)
    tokenCache.set(cacheKey, cached)
    return cached.accessToken
  }
  const existingExchange = tokenExchanges.get(cacheKey)
  if (existingExchange) return existingExchange
  const exchange = exchangeAccessToken(credentials, dataSourceId, cacheKey)
  tokenExchanges.set(cacheKey, exchange)
  try {
    return await exchange
  } finally {
    tokenExchanges.delete(cacheKey)
  }
}

async function exchangeAccessToken(
  credentials: ServiceAccountCredentials,
  dataSourceId: string,
  cacheKey: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${base64UrlJson({ alg: 'RS256', typ: 'JWT' })}.${base64UrlJson({
    iss: credentials.clientEmail,
    scope: PUBSUB_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`
  let signature: string
  try {
    signature = createSign('RSA-SHA256').update(unsigned).end().sign(credentials.privateKey).toString('base64url')
  } catch {
    throw new CredentialsExpired('Google Pub/Sub private_key could not sign a service-account assertion', dataSourceId)
  }
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${unsigned}.${signature}`,
  })
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const body = await readJson(response, 64 * 1024)
  if (
    !response.ok ||
    !isRecord(body) ||
    typeof body.access_token !== 'string' ||
    body.access_token.trim() === ''
  ) {
    const reason = isRecord(body) && typeof body.error === 'string' ? body.error : undefined
    throw new CredentialsExpired('Google rejected the Pub/Sub service-account grant', dataSourceId, {
      status: response.status,
      reason,
      body,
    })
  }
  const expiresIn = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in)
    ? Math.max(60, body.expires_in)
    : 3600
  tokenCache.set(cacheKey, {
    accessToken: body.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  })
  while (tokenCache.size > MAX_TOKEN_CACHE_ENTRIES) {
    const oldestKey = tokenCache.keys().next().value as string | undefined
    if (!oldestKey) break
    tokenCache.delete(oldestKey)
  }
  return body.access_token
}

async function pubSubRequest(
  credentials: ServiceAccountCredentials,
  inv: ConnectorInvocation,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  query?: URLSearchParams,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const token = await accessToken(credentials, inv.source.id)
  const url = new URL(`${API_ROOT}/${path}`)
  if (query) url.search = query.toString()
  const serialized = body === undefined ? undefined : JSON.stringify(body)
  if (serialized && Buffer.byteLength(serialized) > MAX_REQUEST_BYTES) {
    throw new Error(`Google Pub/Sub request exceeds ${MAX_REQUEST_BYTES} bytes`)
  }
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(serialized === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: serialized,
  })
  const responseBody = await readJson(response, MAX_RESPONSE_BYTES)
  if (response.ok) return responseBody

  const providerError = isRecord(responseBody) && isRecord(responseBody.error)
    ? responseBody.error
    : undefined
  const reason = providerError && typeof providerError.status === 'string'
    ? providerError.status
    : undefined
  if (response.status === 401) {
    throw new CredentialsExpired('Google Pub/Sub credentials were rejected', inv.source.id, {
      status: response.status,
      reason,
      body: responseBody,
    })
  }
  if (response.status === 403) {
    throw new ProviderConfigError('Google Pub/Sub API access or IAM permission is missing', inv.source.id, {
      status: response.status,
      reason,
      body: responseBody,
    })
  }
  if (response.status === 429) {
    throw new ProviderRateLimited('Google Pub/Sub rate limit exceeded', inv.source.id, {
      status: response.status,
      reason,
      body: responseBody,
      retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
    })
  }
  const message = providerError && typeof providerError.message === 'string'
    ? providerError.message
    : `HTTP ${response.status}`
  throw new Error(`Google Pub/Sub request failed: ${message}`)
}

function projectPath(credentials: ServiceAccountCredentials, resource: 'topics' | 'subscriptions'): string {
  return `projects/${encodeURIComponent(credentials.projectId)}/${resource}`
}

function topicPath(credentials: ServiceAccountCredentials, value: unknown): string {
  return `${projectPath(credentials, 'topics')}/${encodeURIComponent(resourceId(value, 'topic'))}`
}

function subscriptionPath(credentials: ServiceAccountCredentials, value: unknown): string {
  return `${projectPath(credentials, 'subscriptions')}/${encodeURIComponent(resourceId(value, 'subscription'))}`
}

function resourceId(value: unknown, field: string): string {
  const id = requiredString(value, field)
  if (!/^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(id) || id.toLowerCase().startsWith('goog')) {
    throw new Error(`${field} must be a valid Pub/Sub resource ID`)
  }
  return id
}

function pagination(args: Record<string, unknown>): URLSearchParams {
  const query = new URLSearchParams()
  if (args.pageSize !== undefined) query.set('pageSize', String(boundedInteger(args.pageSize, 'pageSize', 1, 1000)))
  if (args.pageToken !== undefined) query.set('pageToken', requiredString(args.pageToken, 'pageToken'))
  return query
}

function subscriptionBody(credentials: ServiceAccountCredentials, args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { topic: topicPath(credentials, args.topic) }
  setOptionalInteger(body, 'ackDeadlineSeconds', args.ackDeadlineSeconds, 10, 600)
  setOptionalBoolean(body, 'retainAckedMessages', args.retainAckedMessages)
  setOptionalDuration(body, 'messageRetentionDuration', args.messageRetentionDuration)
  if (args.expirationTtl !== undefined) body.expirationPolicy = { ttl: duration(args.expirationTtl, 'expirationTtl') }
  if (args.filter !== undefined) body.filter = requiredString(args.filter, 'filter')
  if (args.deadLetterTopic !== undefined) {
    body.deadLetterPolicy = {
      deadLetterTopic: topicPath(credentials, args.deadLetterTopic),
      maxDeliveryAttempts: boundedInteger(args.maxDeliveryAttempts, 'maxDeliveryAttempts', 5, 100),
    }
  } else if (args.maxDeliveryAttempts !== undefined) {
    throw new Error('maxDeliveryAttempts requires deadLetterTopic')
  }
  if (args.minimumBackoff !== undefined || args.maximumBackoff !== undefined) {
    body.retryPolicy = {
      ...(args.minimumBackoff === undefined ? {} : { minimumBackoff: duration(args.minimumBackoff, 'minimumBackoff') }),
      ...(args.maximumBackoff === undefined ? {} : { maximumBackoff: duration(args.maximumBackoff, 'maximumBackoff') }),
    }
  }
  setOptionalBoolean(body, 'enableMessageOrdering', args.enableMessageOrdering)
  setOptionalBoolean(body, 'enableExactlyOnceDelivery', args.enableExactlyOnceDelivery)
  const labels = optionalStringMap(args.labels, 'labels')
  if (labels) body.labels = labels
  return body
}

function publishMessages(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) {
    throw new Error('messages must contain 1 to 1000 entries')
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`messages[${index}] must be an object`)
    const hasText = typeof entry.text === 'string'
    const hasData = typeof entry.data === 'string'
    if (hasText === hasData) throw new Error(`messages[${index}] requires exactly one of text or data`)
    const data = hasText
      ? Buffer.from(entry.text as string, 'utf8').toString('base64')
      : strictBase64(entry.data as string, `messages[${index}].data`)
    const message: Record<string, unknown> = { data }
    const attributes = optionalStringMap(entry.attributes, `messages[${index}].attributes`)
    if (attributes) message.attributes = attributes
    if (entry.orderingKey !== undefined) message.orderingKey = requiredString(entry.orderingKey, `messages[${index}].orderingKey`)
    return message
  })
}

async function readJson(response: Response, limit: number): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new Error(`Google Pub/Sub response exceeds ${limit} bytes`)
  if (!response.body) return {}
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error(`Google Pub/Sub response exceeds ${limit} bytes`)
    }
    chunks.push(value)
  }
  if (size === 0) return {}
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Google Pub/Sub returned invalid JSON')
  }
}

function requiredCredentialString(value: unknown, field: string, dataSourceId: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CredentialsExpired(`Google Pub/Sub service-account ${field} is missing`, dataSourceId)
  }
  return value.trim()
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`)
  return value.trim()
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function requiredStringArray(value: unknown, field: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new Error(`${field} must contain 1 to ${maximum} strings`)
  }
  return value.map((entry, index) => requiredString(entry, `${field}[${index}]`))
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  return requiredStringArray(value, field, 100)
}

function optionalStringMap(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${field} must be an object of strings`)
  const entries = Object.entries(value)
  if (entries.length > 64) throw new Error(`${field} cannot contain more than 64 entries`)
  return Object.fromEntries(entries.map(([key, entry]) => [
    requiredString(key, `${field} key`),
    requiredString(entry, `${field}.${key}`),
  ]))
}

function setOptionalInteger(
  body: Record<string, unknown>,
  key: string,
  value: unknown,
  minimum: number,
  maximum: number,
): void {
  if (value !== undefined) body[key] = boundedInteger(value, key, minimum, maximum)
}

function setOptionalBoolean(body: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) return
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
  body[key] = value
}

function setOptionalDuration(body: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) body[key] = duration(value, key)
}

function duration(value: unknown, field: string): string {
  const parsed = requiredString(value, field)
  if (!/^\d+(?:\.\d{1,9})?s$/.test(parsed)) throw new Error(`${field} must be a protobuf duration ending in s`)
  return parsed
}

function enumValue<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new Error(`${field} must be one of ${choices.join(', ')}`)
  }
  return value as T
}

function strictBase64(value: string, field: string): string {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${field} must be canonical base64`)
  }
  return value
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function retryAfterMs(value: string | null): number {
  if (!value) return 60_000
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 60_000
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
