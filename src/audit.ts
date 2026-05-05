import { randomUUID } from 'node:crypto'
import type {
  IntegrationActionGuard,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationActor,
  IntegrationConnection,
  IntegrationConnectorAction,
  IntegrationDataClass,
  IntegrationGuardContext,
} from './index.js'

export type IntegrationAuditEventType =
  | 'connection.created'
  | 'connection.updated'
  | 'connection.revoked'
  | 'grant.created'
  | 'grant.revoked'
  | 'capability.issued'
  | 'action.invoked'
  | 'action.failed'
  | 'trigger.subscribed'
  | 'trigger.received'
  | 'workflow.installed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'healthcheck.completed'

export interface IntegrationAuditEvent {
  id: string
  type: IntegrationAuditEventType
  occurredAt: string
  actor?: IntegrationActor
  connectionId?: string
  providerId?: string
  connectorId?: string
  action?: string
  risk?: IntegrationConnectorAction['risk']
  dataClass?: IntegrationDataClass
  ok?: boolean
  message?: string
  metadata?: Record<string, unknown>
}

export interface IntegrationAuditSink {
  record(event: IntegrationAuditEvent): Promise<void> | void
}

export interface IntegrationAuditStore extends IntegrationAuditSink {
  list(filter?: IntegrationAuditFilter): Promise<IntegrationAuditEvent[]> | IntegrationAuditEvent[]
}

export interface IntegrationAuditFilter {
  type?: IntegrationAuditEventType
  actor?: IntegrationActor
  connectionId?: string
  providerId?: string
  connectorId?: string
  action?: string
}

export class InMemoryIntegrationAuditStore implements IntegrationAuditStore {
  private readonly events: IntegrationAuditEvent[] = []

  record(event: IntegrationAuditEvent): void {
    this.events.push(event)
  }

  list(filter: IntegrationAuditFilter = {}): IntegrationAuditEvent[] {
    return this.events.filter((event) => matchesFilter(event, filter))
  }
}

export function createIntegrationAuditEvent(input: Omit<IntegrationAuditEvent, 'id' | 'occurredAt'> & {
  id?: string
  occurredAt?: string | Date
  now?: () => Date
}): IntegrationAuditEvent {
  const occurredAt = input.occurredAt instanceof Date
    ? input.occurredAt.toISOString()
    : input.occurredAt ?? (input.now?.() ?? new Date()).toISOString()
  return {
    ...input,
    id: input.id ?? `audit_${randomUUID()}`,
    occurredAt,
    metadata: input.metadata ? redactUnknown(input.metadata) as Record<string, unknown> : undefined,
  }
}

export function createAuditingActionGuard(options: {
  sink: IntegrationAuditSink
  subject?: IntegrationActor
  now?: () => Date
  includeInputPreview?: boolean
}): IntegrationActionGuard {
  const now = options.now ?? (() => new Date())
  return {
    async invokeAction(ctx: IntegrationGuardContext, proceed: () => Promise<IntegrationActionResult>): Promise<IntegrationActionResult> {
      const startedAt = now()
      try {
        const result = await proceed()
        await options.sink.record(actionEvent({
          ctx,
          request: ctx.request,
          result,
          type: result.ok ? 'action.invoked' : 'action.failed',
          subject: options.subject,
          occurredAt: startedAt,
          includeInputPreview: options.includeInputPreview,
        }))
        return result
      } catch (error) {
        await options.sink.record(actionEvent({
          ctx,
          request: ctx.request,
          type: 'action.failed',
          subject: options.subject,
          occurredAt: startedAt,
          includeInputPreview: options.includeInputPreview,
          message: error instanceof Error ? error.message : 'Integration action failed.',
        }))
        throw error
      }
    },
  }
}

export function sanitizeAuditConnection(connection: IntegrationConnection): Record<string, unknown> {
  return {
    id: connection.id,
    owner: connection.owner,
    providerId: connection.providerId,
    connectorId: connection.connectorId,
    status: connection.status,
    grantedScopes: connection.grantedScopes,
    account: connection.account,
    hasSecretRef: Boolean(connection.secretRef),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    expiresAt: connection.expiresAt,
    lastUsedAt: connection.lastUsedAt,
  }
}

function actionEvent(input: {
  ctx: IntegrationGuardContext
  request: IntegrationActionRequest
  result?: IntegrationActionResult
  type: 'action.invoked' | 'action.failed'
  subject?: IntegrationActor
  occurredAt: Date
  includeInputPreview?: boolean
  message?: string
}): IntegrationAuditEvent {
  return createIntegrationAuditEvent({
    type: input.type,
    occurredAt: input.occurredAt,
    actor: input.subject ?? input.ctx.connection.owner,
    connectionId: input.ctx.connection.id,
    providerId: input.ctx.connection.providerId,
    connectorId: input.ctx.connection.connectorId,
    action: input.request.action,
    risk: input.ctx.action?.risk,
    dataClass: input.ctx.action?.dataClass,
    ok: input.result?.ok ?? false,
    message: input.message,
    metadata: {
      idempotencyKey: input.request.idempotencyKey,
      dryRun: input.request.dryRun,
      externalId: input.result?.externalId,
      warnings: input.result?.warnings,
      inputPreview: input.includeInputPreview ? redactUnknown(input.request.input) : undefined,
    },
  })
}

function matchesFilter(event: IntegrationAuditEvent, filter: IntegrationAuditFilter): boolean {
  if (filter.type && event.type !== filter.type) return false
  if (filter.actor && (!event.actor || event.actor.type !== filter.actor.type || event.actor.id !== filter.actor.id)) return false
  if (filter.connectionId && event.connectionId !== filter.connectionId) return false
  if (filter.providerId && event.providerId !== filter.providerId) return false
  if (filter.connectorId && event.connectorId !== filter.connectorId) return false
  if (filter.action && event.action !== filter.action) return false
  return true
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUnknown)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (/token|secret|password|authorization|api[_-]?key|credential|refresh/i.test(key)) {
      out[key] = '[REDACTED]'
    } else {
      out[key] = redactUnknown(child)
    }
  }
  return out
}
