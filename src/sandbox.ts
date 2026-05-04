import type {
  IntegrationActionResult,
  IntegrationApprovalRequest,
  IntegrationCapability,
  InvokeWithCapabilityRequest,
} from './index.js'
import { parseIntegrationToolName } from './catalog.js'

export interface IntegrationInvocationEnvelope {
  kind: 'integration.invocation'
  capabilityToken: string
  toolName: string
  action: string
  input?: unknown
  idempotencyKey: string
  dryRun?: boolean
  metadata?: Record<string, unknown>
}

export type NormalizedIntegrationResult =
  | { status: 'ok'; action: string; output?: unknown; metadata?: Record<string, unknown> }
  | { status: 'approval_required'; action: string; approval: IntegrationApprovalRequest; metadata?: Record<string, unknown> }
  | { status: 'failed'; action: string; error: string; metadata?: Record<string, unknown> }

export function buildIntegrationInvocationEnvelope(input: {
  capabilityToken: string
  toolName: string
  args?: unknown
  idempotencyKey: string
  dryRun?: boolean
  metadata?: Record<string, unknown>
}): IntegrationInvocationEnvelope {
  const parsed = parseIntegrationToolName(input.toolName)
  return {
    kind: 'integration.invocation',
    capabilityToken: input.capabilityToken,
    toolName: input.toolName,
    action: parsed.actionId,
    input: input.args,
    idempotencyKey: input.idempotencyKey,
    dryRun: input.dryRun,
    metadata: input.metadata,
  }
}

export function invocationRequestFromEnvelope(envelope: IntegrationInvocationEnvelope): InvokeWithCapabilityRequest {
  return {
    action: envelope.action,
    input: envelope.input,
    idempotencyKey: envelope.idempotencyKey,
    dryRun: envelope.dryRun,
    metadata: envelope.metadata,
  }
}

export function redactInvocationEnvelope(envelope: IntegrationInvocationEnvelope): Omit<IntegrationInvocationEnvelope, 'capabilityToken'> & { capabilityToken: '[REDACTED]' } {
  return {
    ...envelope,
    capabilityToken: '[REDACTED]',
    input: redactUnknown(envelope.input),
  }
}

export function redactCapability(capability: IntegrationCapability): IntegrationCapability {
  return {
    ...capability,
    metadata: redactUnknown(capability.metadata) as Record<string, unknown> | undefined,
  }
}

export function normalizeIntegrationResult(result: IntegrationActionResult): NormalizedIntegrationResult {
  const output = result.output as { approvalRequired?: unknown; approval?: IntegrationApprovalRequest } | undefined
  if (!result.ok && output?.approvalRequired === true && output.approval) {
    return {
      status: 'approval_required',
      action: result.action,
      approval: output.approval,
      metadata: result.metadata,
    }
  }
  if (!result.ok) {
    return {
      status: 'failed',
      action: result.action,
      error: String(result.output ?? result.warnings?.[0] ?? 'integration action failed'),
      metadata: result.metadata,
    }
  }
  return {
    status: 'ok',
    action: result.action,
    output: result.output,
    metadata: result.metadata,
  }
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
