import { createHash, timingSafeEqual } from 'node:crypto'
import {
  CredentialsExpired,
  ProviderConfigError,
  ProviderRateLimited,
  type CapabilityMutationResult,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ConnectorInvocation,
  type EventHandlerResult,
  type ResolvedDataSource,
} from '../types.js'

const API_VERSION = '2018-01-01'
const MAX_BATCH_BYTES = 1024 * 1024
const MAX_EVENTS = 5000
const EVENT_GRID_SUFFIXES = [
  '.eventgrid.azure.net',
  '.eventgrid.azure.us',
  '.eventgrid.azure.cn',
] as const

interface EventGridCredentials {
  endpoint: URL
  accessKey: string
  deliverySecret: string
}

export const azureEventGridConnector: ConnectorAdapter = {
  manifest: {
    kind: 'azure-event-grid',
    displayName: 'Azure Event Grid',
    description:
      'Publish Event Grid and CloudEvents batches to customer topics and authenticate inbound subscription validation and event delivery.',
    auth: {
      kind: 'api-key',
      hint: 'JSON containing endpoint, accessKey, and deliverySecret. endpoint is the Azure custom topic or domain /api/events URL. Configure deliverySecret as the static x-tangle-eventgrid-secret delivery header on each Event Grid subscription.',
    },
    category: 'webhook',
    defaultConsistencyModel: 'advisory',
    rateLimit: { requests: 600, windowMs: 60_000, scope: 'data-source' },
    capabilities: [
      mutationCapability(
        'events.publish',
        'Publish a bounded batch using the native Azure Event Grid event schema.',
        'Events require id, eventType, subject, eventTime, dataVersion, and data.',
      ),
      mutationCapability(
        'cloudEvents.publish',
        'Publish a bounded CloudEvents 1.0 batch.',
        'CloudEvents require id, source, type, specversion=1.0, and data.',
      ),
    ],
  },

  async executeMutation(inv): Promise<CapabilityMutationResult> {
    const credentials = parseCredentials(inv.source.credentials, inv.source.id)
    const events = inv.capabilityName === 'events.publish'
      ? eventGridEvents(inv.args.events)
      : inv.capabilityName === 'cloudEvents.publish'
        ? cloudEvents(inv.args.events)
        : undefined
    if (!events) throw new Error(`azure-event-grid: unknown mutation capability ${inv.capabilityName}`)
    const body = JSON.stringify(events)
    if (Buffer.byteLength(body) > MAX_BATCH_BYTES) {
      throw new Error(`Azure Event Grid batch exceeds ${MAX_BATCH_BYTES} bytes`)
    }
    const response = await fetch(publishUrl(credentials.endpoint), {
      method: 'POST',
      headers: {
        'aeg-sas-key': credentials.accessKey,
        'content-type': inv.capabilityName === 'cloudEvents.publish'
          ? 'application/cloudevents-batch+json; charset=utf-8'
          : 'application/json; charset=utf-8',
        accept: 'application/json',
      },
      body,
    })
    const responseBody = await readBoundedText(response, 256 * 1024)
    if (!response.ok) throwEventGridError(response, responseBody, inv)
    return {
      status: 'committed',
      data: { accepted: true, count: events.length, requestId: response.headers.get('x-ms-request-id') ?? undefined },
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  verifySignature({ headers, source }) {
    let credentials: EventGridCredentials
    try {
      credentials = parseCredentials(source.credentials, source.id)
    } catch {
      return { valid: false, reason: 'Azure Event Grid credentials are invalid' }
    }
    const provided = headerValue(headers, 'x-tangle-eventgrid-secret')
    if (!provided) return { valid: false, reason: 'Missing x-tangle-eventgrid-secret delivery header' }
    const expectedDigest = createHash('sha256').update(credentials.deliverySecret).digest()
    const providedDigest = createHash('sha256').update(provided).digest()
    return timingSafeEqual(expectedDigest, providedDigest)
      ? { valid: true }
      : { valid: false, reason: 'Invalid x-tangle-eventgrid-secret delivery header' }
  },

  async handleInboundEvent({ rawBody }): Promise<EventHandlerResult> {
    if (Buffer.byteLength(rawBody) > MAX_BATCH_BYTES) {
      throw new Error(`Azure Event Grid delivery exceeds ${MAX_BATCH_BYTES} bytes`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      throw new Error('Azure Event Grid delivery body must be valid JSON')
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed]
    if (entries.length > MAX_EVENTS) throw new Error(`Azure Event Grid delivery exceeds ${MAX_EVENTS} events`)
    const validation = entries.find((entry) => isValidationEvent(entry))
    if (validation && isRecord(validation.data) && typeof validation.data.validationCode === 'string') {
      return {
        events: [],
        response: { status: 200, body: { validationResponse: validation.data.validationCode } },
      }
    }
    return {
      events: entries.map((entry, index) => inboundEvent(entry, index)),
    }
  },

  async test(source) {
    try {
      parseCredentials(source.credentials, source.id)
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'Azure Event Grid credentials are invalid' }
    }
  },
}

function mutationCapability(name: string, description: string, eventDescription: string) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_EVENTS,
          description: eventDescription,
        },
      },
      required: ['events'],
    },
    cas: 'none' as const,
    externalEffect: true,
  }
}

function parseCredentials(credentials: ConnectorCredentials, dataSourceId: string): EventGridCredentials {
  if (credentials.kind !== 'api-key') {
    throw new CredentialsExpired('Azure Event Grid requires a credential JSON bundle', dataSourceId)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(credentials.apiKey)
  } catch {
    throw new CredentialsExpired('Azure Event Grid credentials must be valid JSON', dataSourceId)
  }
  if (!isRecord(parsed)) throw new CredentialsExpired('Azure Event Grid credentials must be a JSON object', dataSourceId)
  const endpointValue = credentialString(parsed.endpoint, 'endpoint', dataSourceId)
  const accessKey = credentialString(parsed.accessKey, 'accessKey', dataSourceId)
  const deliverySecret = credentialString(parsed.deliverySecret, 'deliverySecret', dataSourceId)
  let endpoint: URL
  try {
    endpoint = new URL(endpointValue)
  } catch {
    throw new CredentialsExpired('Azure Event Grid endpoint is invalid', dataSourceId)
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname.replace(/\/$/, '').toLowerCase() !== '/api/events' ||
    !EVENT_GRID_SUFFIXES.some((suffix) => endpoint.hostname.endsWith(suffix))
  ) {
    throw new CredentialsExpired('Azure Event Grid endpoint must be a public Azure custom topic or domain /api/events URL', dataSourceId)
  }
  if (!canonicalBase64(accessKey) || Buffer.from(accessKey, 'base64').length < 16) {
    throw new CredentialsExpired('Azure Event Grid accessKey must be a valid base64 topic key', dataSourceId)
  }
  if (deliverySecret.length < 32 || deliverySecret.length > 4096) {
    throw new CredentialsExpired('Azure Event Grid deliverySecret must contain 32 to 4096 characters', dataSourceId)
  }
  endpoint.pathname = '/api/events'
  return { endpoint, accessKey, deliverySecret }
}

function publishUrl(endpoint: URL): URL {
  const url = new URL(endpoint)
  url.searchParams.set('api-version', API_VERSION)
  return url
}

function eventGridEvents(value: unknown): Array<Record<string, unknown>> {
  const entries = eventArray(value)
  return entries.map((entry, index) => {
    const result: Record<string, unknown> = {
      id: requiredString(entry.id, `events[${index}].id`),
      eventType: requiredString(entry.eventType, `events[${index}].eventType`),
      subject: requiredString(entry.subject, `events[${index}].subject`),
      eventTime: isoDate(entry.eventTime, `events[${index}].eventTime`),
      dataVersion: requiredString(entry.dataVersion, `events[${index}].dataVersion`),
      data: requiredJsonValue(entry.data, `events[${index}].data`),
    }
    if (entry.topic !== undefined) result.topic = requiredString(entry.topic, `events[${index}].topic`)
    return result
  })
}

function cloudEvents(value: unknown): Array<Record<string, unknown>> {
  const entries = eventArray(value)
  return entries.map((entry, index) => {
    if (entry.specversion !== '1.0') throw new Error(`events[${index}].specversion must be 1.0`)
    const result: Record<string, unknown> = {
      specversion: '1.0',
      id: requiredString(entry.id, `events[${index}].id`),
      source: requiredString(entry.source, `events[${index}].source`),
      type: requiredString(entry.type, `events[${index}].type`),
      data: requiredJsonValue(entry.data, `events[${index}].data`),
    }
    if (entry.subject !== undefined) result.subject = requiredString(entry.subject, `events[${index}].subject`)
    if (entry.time !== undefined) result.time = isoDate(entry.time, `events[${index}].time`)
    if (entry.datacontenttype !== undefined) result.datacontenttype = requiredString(entry.datacontenttype, `events[${index}].datacontenttype`)
    if (entry.dataschema !== undefined) result.dataschema = requiredString(entry.dataschema, `events[${index}].dataschema`)
    return result
  })
}

function eventArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVENTS) {
    throw new Error(`events must contain 1 to ${MAX_EVENTS} entries`)
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`events[${index}] must be an object`)
    return entry
  })
}

function inboundEvent(entry: unknown, index: number) {
  if (!isRecord(entry)) throw new Error(`Azure Event Grid delivery entry ${index} must be an object`)
  const eventType = typeof entry.eventType === 'string'
    ? entry.eventType
    : typeof entry.type === 'string'
      ? entry.type
      : 'azure.event-grid.event'
  return {
    eventType,
    providerEventId: typeof entry.id === 'string' ? entry.id : undefined,
    payload: entry,
  }
}

function isValidationEvent(value: unknown): value is Record<string, unknown> & { data: unknown } {
  return isRecord(value) && value.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent'
}

function throwEventGridError(response: Response, body: string, inv: ConnectorInvocation): never {
  const redacted = body.replace(/[A-Za-z0-9+/]{32,}={0,2}/g, '[redacted]').slice(0, 500)
  if (response.status === 401) {
    throw new CredentialsExpired('Azure Event Grid rejected the topic access key', inv.source.id, {
      status: response.status,
      body: redacted,
    })
  }
  if (response.status === 403) {
    throw new ProviderConfigError('Azure Event Grid topic policy rejected publishing', inv.source.id, {
      status: response.status,
      body: redacted,
    })
  }
  if (response.status === 429 || response.status === 503) {
    throw new ProviderRateLimited('Azure Event Grid is throttling publishes', inv.source.id, {
      status: response.status,
      body: redacted,
      retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
    })
  }
  throw new Error(`Azure Event Grid publish failed with HTTP ${response.status}: ${redacted}`)
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new Error(`Azure Event Grid response exceeds ${limit} bytes`)
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error(`Azure Event Grid response exceeds ${limit} bytes`)
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body)
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
  return Array.isArray(match) ? match[0] : match
}

function credentialString(value: unknown, field: string, dataSourceId: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CredentialsExpired(`Azure Event Grid ${field} is missing`, dataSourceId)
  }
  return value.trim()
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4096) {
    throw new Error(`${field} must be a non-empty string no longer than 4096 characters`)
  }
  return value
}

function isoDate(value: unknown, field: string): string {
  const parsed = requiredString(value, field)
  const date = new Date(parsed)
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be an ISO 8601 timestamp`)
  return date.toISOString()
}

function requiredJsonValue(value: unknown, field: string): unknown {
  if (value === undefined) throw new Error(`${field} is required`)
  try {
    if (JSON.stringify(value) === undefined) throw new Error('not JSON')
  } catch {
    throw new Error(`${field} must be JSON-serializable`)
  }
  return value
}

function canonicalBase64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) &&
    Buffer.from(value, 'base64').toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')
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
