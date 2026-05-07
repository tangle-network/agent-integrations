import type {
  ConnectorAdapter,
  InboundEvent,
  ResolvedDataSource,
} from './connectors/types.js'
import type {
  IntegrationTriggerEvent,
} from './index.js'
import type { IntegrationWorkflowRuntime } from './workflow.js'

export interface StoredIntegrationEvent {
  id: string
  sourceId: string
  connectorId: string
  eventType: string
  providerEventId?: string
  receivedAt: string
  payload: Record<string, unknown>
  dispatchedAt?: string
  metadata?: Record<string, unknown>
}

export interface IntegrationEventStore {
  put(event: StoredIntegrationEvent): Promise<void> | void
  hasProviderEvent(sourceId: string, providerEventId: string): Promise<boolean> | boolean
  list(): Promise<StoredIntegrationEvent[]> | StoredIntegrationEvent[]
}

export interface IntegrationWebhookReceiverResult {
  status: number
  body: unknown
  headers?: Record<string, string>
  received: StoredIntegrationEvent[]
  duplicates: StoredIntegrationEvent[]
}

export class InMemoryIntegrationEventStore implements IntegrationEventStore {
  private readonly events = new Map<string, StoredIntegrationEvent>()
  private readonly providerIds = new Set<string>()

  put(event: StoredIntegrationEvent): void {
    this.events.set(event.id, event)
    if (event.providerEventId) this.providerIds.add(providerKey(event.sourceId, event.providerEventId))
  }

  hasProviderEvent(sourceId: string, providerEventId: string): boolean {
    return this.providerIds.has(providerKey(sourceId, providerEventId))
  }

  list(): StoredIntegrationEvent[] {
    return [...this.events.values()]
  }
}

export async function receiveIntegrationWebhook(input: {
  adapter: ConnectorAdapter
  source: ResolvedDataSource
  rawBody: string
  headers: Record<string, string | string[] | undefined>
  store: IntegrationEventStore
  workflowRuntime?: IntegrationWorkflowRuntime
  allowUnsignedWebhook?: boolean
  now?: () => Date
}): Promise<IntegrationWebhookReceiverResult> {
  if (!input.adapter.handleInboundEvent) {
    return { status: 405, body: { ok: false, error: 'Connector does not support inbound webhooks.' }, received: [], duplicates: [] }
  }
  if (!input.adapter.verifySignature && !input.allowUnsignedWebhook) {
    return { status: 401, body: { ok: false, error: 'Webhook signature verification is required.' }, received: [], duplicates: [] }
  }
  const signature = input.adapter.verifySignature?.({
    rawBody: input.rawBody,
    headers: input.headers,
    source: input.source,
  })
  if (signature && !signature.valid) {
    return { status: 401, body: { ok: false, error: signature.reason ?? 'Invalid webhook signature.' }, received: [], duplicates: [] }
  }

  const handled = await input.adapter.handleInboundEvent({
    source: input.source,
    rawBody: input.rawBody,
    headers: input.headers,
  })
  const received: StoredIntegrationEvent[] = []
  const duplicates: StoredIntegrationEvent[] = []
  for (const inbound of handled.events) {
    const event = storedEvent(input.source, inbound, input.now ?? (() => new Date()))
    if (event.providerEventId && await input.store.hasProviderEvent(event.sourceId, event.providerEventId)) {
      duplicates.push(event)
      continue
    }
    await input.store.put(event)
    received.push(event)
    await dispatchStoredEvent(event, input.source, input.workflowRuntime)
  }

  return {
    status: handled.response?.status ?? 200,
    body: handled.response?.body ?? { received: true, count: received.length, duplicateCount: duplicates.length },
    headers: handled.response?.headers,
    received,
    duplicates,
  }
}

export function storedEventToTriggerEvent(event: StoredIntegrationEvent, source: ResolvedDataSource): IntegrationTriggerEvent {
  return {
    id: event.id,
    providerId: String(source.metadata.providerId ?? 'first-party'),
    connectorId: event.connectorId,
    connectionId: source.id,
    trigger: event.eventType,
    occurredAt: event.receivedAt,
    payload: event.payload,
    metadata: {
      providerEventId: event.providerEventId,
      sourceId: event.sourceId,
      ...event.metadata,
    },
  }
}

async function dispatchStoredEvent(
  event: StoredIntegrationEvent,
  source: ResolvedDataSource,
  workflowRuntime?: IntegrationWorkflowRuntime,
): Promise<void> {
  if (!workflowRuntime) return
  await workflowRuntime.dispatchEvent(storedEventToTriggerEvent(event, source), () => undefined)
}

function storedEvent(source: ResolvedDataSource, event: InboundEvent, now: () => Date): StoredIntegrationEvent {
  return {
    id: `evt_${source.id}_${event.providerEventId ?? `${event.eventType}_${now().getTime()}`}`,
    sourceId: source.id,
    connectorId: source.kind,
    eventType: event.eventType,
    providerEventId: event.providerEventId,
    receivedAt: now().toISOString(),
    payload: event.payload,
  }
}

function providerKey(sourceId: string, providerEventId: string): string {
  return `${sourceId}:${providerEventId}`
}
