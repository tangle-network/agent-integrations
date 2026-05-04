import { randomUUID } from 'node:crypto'
import type {
  IntegrationActionRisk,
  IntegrationApprovalRequest,
  IntegrationDataClass,
  IntegrationGuardContext,
  IntegrationPolicyDecision,
  IntegrationPolicyEngine,
} from './index.js'

export type IntegrationPolicyEffect = 'allow' | 'require_approval' | 'deny'

export interface IntegrationPolicyRule {
  id: string
  effect: IntegrationPolicyEffect
  reason: string
  providerId?: string
  connectorId?: string
  action?: string
  maxRisk?: IntegrationActionRisk
  risk?: IntegrationActionRisk
  dataClass?: IntegrationDataClass
}

export interface StaticIntegrationPolicyOptions {
  rules?: IntegrationPolicyRule[]
  defaultReadEffect?: IntegrationPolicyEffect
  defaultWriteEffect?: IntegrationPolicyEffect
  defaultDestructiveEffect?: IntegrationPolicyEffect
  now?: () => Date
}

export interface IntegrationApprovalResolution {
  approvalId: string
  approved: boolean
  resolvedBy: string
  resolvedAt: string
  reason?: string
  metadata?: Record<string, unknown>
}

export class StaticIntegrationPolicyEngine implements IntegrationPolicyEngine {
  private readonly rules: IntegrationPolicyRule[]
  private readonly defaultReadEffect: IntegrationPolicyEffect
  private readonly defaultWriteEffect: IntegrationPolicyEffect
  private readonly defaultDestructiveEffect: IntegrationPolicyEffect
  private readonly now: () => Date

  constructor(options: StaticIntegrationPolicyOptions = {}) {
    this.rules = options.rules ?? []
    this.defaultReadEffect = options.defaultReadEffect ?? 'allow'
    this.defaultWriteEffect = options.defaultWriteEffect ?? 'require_approval'
    this.defaultDestructiveEffect = options.defaultDestructiveEffect ?? 'deny'
    this.now = options.now ?? (() => new Date())
  }

  decide(ctx: IntegrationGuardContext & { subject: { type: string; id: string } }): IntegrationPolicyDecision {
    const action = ctx.action
    if (!action) return { decision: 'deny', reason: 'Integration action is missing from connector catalog.' }
    const matched = this.rules.find((rule) => ruleMatches(rule, ctx))
    const effect = matched?.effect ?? this.defaultEffect(action.risk)
    const reason = matched?.reason ?? defaultReason(effect, action.risk)
    if (effect === 'allow') return { decision: 'allow', reason, metadata: matched ? { ruleId: matched.id } : undefined }
    if (effect === 'deny') return { decision: 'deny', reason, metadata: matched ? { ruleId: matched.id } : undefined }
    return {
      decision: 'require_approval',
      reason,
      approval: buildApprovalRequest(ctx, reason, this.now()),
      metadata: matched ? { ruleId: matched.id } : undefined,
    }
  }

  private defaultEffect(risk: IntegrationActionRisk): IntegrationPolicyEffect {
    if (risk === 'read') return this.defaultReadEffect
    if (risk === 'write') return this.defaultWriteEffect
    return this.defaultDestructiveEffect
  }
}

export function createDefaultIntegrationPolicyEngine(options: Omit<StaticIntegrationPolicyOptions, 'rules'> = {}): StaticIntegrationPolicyEngine {
  return new StaticIntegrationPolicyEngine(options)
}

export function buildApprovalRequest(
  ctx: IntegrationGuardContext & { subject: { type: string; id: string } },
  reason: string,
  requestedAt: Date,
): IntegrationApprovalRequest {
  if (!ctx.action) {
    throw new Error('Cannot build approval request without an action descriptor.')
  }
  return {
    id: `approval_${randomUUID()}`,
    connectionId: ctx.connection.id,
    providerId: ctx.connection.providerId,
    connectorId: ctx.connection.connectorId,
    action: ctx.request.action,
    actor: { type: ctx.subject.type as never, id: ctx.subject.id },
    risk: ctx.action.risk,
    dataClass: ctx.action.dataClass,
    reason,
    requestedAt: requestedAt.toISOString(),
    inputPreview: previewInput(ctx.request.input),
  }
}

export function redactApprovalRequest(request: IntegrationApprovalRequest): IntegrationApprovalRequest {
  return {
    ...request,
    inputPreview: redactUnknown(request.inputPreview),
  }
}

function ruleMatches(rule: IntegrationPolicyRule, ctx: IntegrationGuardContext): boolean {
  if (!ctx.action) return false
  if (rule.providerId && rule.providerId !== ctx.connection.providerId) return false
  if (rule.connectorId && rule.connectorId !== ctx.connection.connectorId) return false
  if (rule.action && rule.action !== ctx.request.action) return false
  if (rule.risk && rule.risk !== ctx.action.risk) return false
  if (rule.maxRisk && riskRank(ctx.action.risk) > riskRank(rule.maxRisk)) return false
  if (rule.dataClass && rule.dataClass !== ctx.action.dataClass) return false
  return true
}

function riskRank(risk: IntegrationActionRisk): number {
  if (risk === 'read') return 0
  if (risk === 'write') return 1
  return 2
}

function defaultReason(effect: IntegrationPolicyEffect, risk: IntegrationActionRisk): string {
  if (effect === 'allow') return `${risk} integration action allowed by default policy.`
  if (effect === 'deny') return `${risk} integration action denied by default policy.`
  return `${risk} integration action requires approval by default policy.`
}

function previewInput(input: unknown): unknown {
  return redactUnknown(input)
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUnknown)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (/token|secret|password|authorization|api[_-]?key|credential/i.test(key)) {
      out[key] = '[REDACTED]'
    } else {
      out[key] = redactUnknown(child)
    }
  }
  return out
}
