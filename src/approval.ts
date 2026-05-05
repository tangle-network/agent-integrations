import { createHash } from 'node:crypto'
import type {
  IntegrationActor,
  IntegrationApprovalRequest,
  IntegrationGuardContext,
  IntegrationPolicyDecision,
  IntegrationPolicyEngine,
} from './index.js'
import type { IntegrationAuditSink } from './audit.js'
import { createIntegrationAuditEvent } from './audit.js'

export type IntegrationApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'

export interface IntegrationApprovalRecord {
  id: string
  request: IntegrationApprovalRequest
  status: IntegrationApprovalStatus
  requestedAt: string
  resolvedAt?: string
  resolvedBy?: IntegrationActor
  reason?: string
  expiresAt?: string
  metadata?: Record<string, unknown>
}

export interface IntegrationApprovalStore {
  get(approvalId: string): Promise<IntegrationApprovalRecord | undefined> | IntegrationApprovalRecord | undefined
  put(record: IntegrationApprovalRecord): Promise<void> | void
  list(filter?: IntegrationApprovalFilter): Promise<IntegrationApprovalRecord[]> | IntegrationApprovalRecord[]
}

export interface IntegrationApprovalFilter {
  status?: IntegrationApprovalStatus
  connectionId?: string
  connectorId?: string
  action?: string
  actor?: IntegrationActor
}

export interface ApprovalBackedPolicyOptions {
  base: IntegrationPolicyEngine
  store: IntegrationApprovalStore
  audit?: IntegrationAuditSink
  now?: () => Date
  approvalTtlMs?: number
}

export class InMemoryIntegrationApprovalStore implements IntegrationApprovalStore {
  private readonly records = new Map<string, IntegrationApprovalRecord>()

  get(approvalId: string): IntegrationApprovalRecord | undefined {
    return this.records.get(approvalId)
  }

  put(record: IntegrationApprovalRecord): void {
    this.records.set(record.id, record)
  }

  list(filter: IntegrationApprovalFilter = {}): IntegrationApprovalRecord[] {
    return [...this.records.values()].filter((record) => matchesFilter(record, filter))
  }
}

export class ApprovalBackedPolicyEngine implements IntegrationPolicyEngine {
  private readonly base: IntegrationPolicyEngine
  private readonly store: IntegrationApprovalStore
  private readonly audit: IntegrationAuditSink | undefined
  private readonly now: () => Date
  private readonly approvalTtlMs: number | undefined

  constructor(options: ApprovalBackedPolicyOptions) {
    this.base = options.base
    this.store = options.store
    this.audit = options.audit
    this.now = options.now ?? (() => new Date())
    this.approvalTtlMs = options.approvalTtlMs
  }

  async decide(ctx: IntegrationGuardContext & { subject: IntegrationActor }): Promise<IntegrationPolicyDecision> {
    const approved = await this.findApprovedRecord(ctx)
    if (approved) return { decision: 'allow', reason: `Approved by ${approved.resolvedBy?.type ?? 'actor'} ${approved.resolvedBy?.id ?? 'unknown'}.`, metadata: { approvalId: approved.id } }

    const decision = await this.base.decide(ctx)
    if (decision.decision !== 'require_approval') return decision

    const requestedAt = decision.approval.requestedAt
    const expiresAt = this.approvalTtlMs ? new Date(Date.parse(requestedAt) + this.approvalTtlMs).toISOString() : undefined
    const record: IntegrationApprovalRecord = {
      id: decision.approval.id,
      request: decision.approval,
      status: 'pending',
      requestedAt,
      expiresAt,
      metadata: { ...(decision.metadata ?? {}), inputHash: approvalInputHash(ctx.request.input) },
    }
    await this.store.put(record)
    await this.audit?.record(createIntegrationAuditEvent({
      type: 'approval.requested',
      actor: ctx.subject,
      connectionId: ctx.connection.id,
      providerId: ctx.connection.providerId,
      connectorId: ctx.connection.connectorId,
      action: ctx.request.action,
      risk: ctx.action?.risk,
      dataClass: ctx.action?.dataClass,
      message: decision.reason,
      metadata: { approvalId: record.id },
      now: this.now,
    }))
    return decision
  }

  private async findApprovedRecord(ctx: IntegrationGuardContext & { subject: IntegrationActor }): Promise<IntegrationApprovalRecord | undefined> {
    const approvalId = typeof ctx.request.metadata?.approvalId === 'string' ? ctx.request.metadata.approvalId : undefined
    if (!approvalId) return undefined
    const record = await this.store.get(approvalId)
    if (!record || record.status !== 'approved') return undefined
    if (record.expiresAt && Date.parse(record.expiresAt) <= this.now().getTime()) {
      await this.store.put({ ...record, status: 'expired' })
      return undefined
    }
    if (!approvalMatches(record, ctx)) return undefined
    return record
  }
}

export function createApprovalBackedPolicyEngine(options: ApprovalBackedPolicyOptions): ApprovalBackedPolicyEngine {
  return new ApprovalBackedPolicyEngine(options)
}

export async function resolveIntegrationApproval(input: {
  store: IntegrationApprovalStore
  approvalId: string
  approved: boolean
  resolvedBy: IntegrationActor
  reason?: string
  metadata?: Record<string, unknown>
  audit?: IntegrationAuditSink
  now?: () => Date
}): Promise<IntegrationApprovalRecord> {
  const record = await input.store.get(input.approvalId)
  if (!record) throw new Error(`Approval ${input.approvalId} not found.`)
  const now = input.now ?? (() => new Date())
  const next: IntegrationApprovalRecord = {
    ...record,
    status: input.approved ? 'approved' : 'denied',
    resolvedAt: now().toISOString(),
    resolvedBy: input.resolvedBy,
    reason: input.reason,
    metadata: { ...(record.metadata ?? {}), ...(input.metadata ?? {}) },
  }
  await input.store.put(next)
  await input.audit?.record(createIntegrationAuditEvent({
    type: 'approval.resolved',
    actor: input.resolvedBy,
    connectionId: record.request.connectionId,
    providerId: record.request.providerId,
    connectorId: record.request.connectorId,
    action: record.request.action,
    risk: record.request.risk,
    dataClass: record.request.dataClass,
    ok: input.approved,
    message: input.reason,
    metadata: { approvalId: record.id, status: next.status },
    now,
  }))
  return next
}

function approvalMatches(record: IntegrationApprovalRecord, ctx: IntegrationGuardContext & { subject: IntegrationActor }): boolean {
  return record.request.connectionId === ctx.connection.id
    && record.request.providerId === ctx.connection.providerId
    && record.request.connectorId === ctx.connection.connectorId
    && record.request.action === ctx.request.action
    && record.request.actor.type === ctx.subject.type
    && record.request.actor.id === ctx.subject.id
    && record.metadata?.inputHash === approvalInputHash(ctx.request.input)
}

function matchesFilter(record: IntegrationApprovalRecord, filter: IntegrationApprovalFilter): boolean {
  if (filter.status && record.status !== filter.status) return false
  if (filter.connectionId && record.request.connectionId !== filter.connectionId) return false
  if (filter.connectorId && record.request.connectorId !== filter.connectorId) return false
  if (filter.action && record.request.action !== filter.action) return false
  if (filter.actor && (record.request.actor.type !== filter.actor.type || record.request.actor.id !== filter.actor.id)) return false
  return true
}

function approvalInputHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input ?? null)).digest('base64url')
}
