import type {
  IntegrationActionResult,
  IntegrationApprovalRequest,
  IntegrationCapability,
  IntegrationConnector,
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

export interface IntegrationInvocationEnvelopeValidationOptions {
  connectors?: IntegrationConnector[]
  maxInputBytes?: number
  requireKnownTool?: boolean
}

export type NormalizedIntegrationResult =
  | { status: 'ok'; action: string; output?: unknown; metadata?: Record<string, unknown> }
  | { status: 'approval_required'; action: string; approval: IntegrationApprovalRequest; metadata?: Record<string, unknown> }
  | { status: 'failed'; action: string; error: string; metadata?: Record<string, unknown> }

export interface IntegrationSandboxHostHub {
  invokeWithCapability(token: string, request: InvokeWithCapabilityRequest): Promise<IntegrationActionResult> | IntegrationActionResult
}

export interface IntegrationSandboxHostOptions extends IntegrationInvocationEnvelopeValidationOptions {
  hub: IntegrationSandboxHostHub
}

export function buildIntegrationInvocationEnvelope(input: {
  capabilityToken: string
  toolName: string
  args?: unknown
  idempotencyKey: string
  dryRun?: boolean
  metadata?: Record<string, unknown>
}): IntegrationInvocationEnvelope {
  const parsed = parseIntegrationToolName(input.toolName)
  const envelope: IntegrationInvocationEnvelope = {
    kind: 'integration.invocation',
    capabilityToken: input.capabilityToken,
    toolName: input.toolName,
    action: parsed.actionId,
    input: input.args,
    idempotencyKey: input.idempotencyKey,
    dryRun: input.dryRun,
    metadata: input.metadata,
  }
  validateIntegrationInvocationEnvelope(envelope)
  return envelope
}

export function invocationRequestFromEnvelope(envelope: IntegrationInvocationEnvelope): InvokeWithCapabilityRequest {
  validateIntegrationInvocationEnvelope(envelope)
  return {
    action: envelope.action,
    input: envelope.input,
    idempotencyKey: envelope.idempotencyKey,
    dryRun: envelope.dryRun,
    metadata: envelope.metadata,
  }
}

export function validateIntegrationInvocationEnvelope(
  envelope: IntegrationInvocationEnvelope,
  options: IntegrationInvocationEnvelopeValidationOptions = {},
): void {
  if (!envelope || typeof envelope !== 'object') throw new Error('Integration invocation envelope is required.')
  if (envelope.kind !== 'integration.invocation') throw new Error('Invalid integration invocation envelope kind.')
  if (!isNonEmptyString(envelope.capabilityToken)) throw new Error('Integration invocation envelope is missing capabilityToken.')
  if (!isNonEmptyString(envelope.toolName)) throw new Error('Integration invocation envelope is missing toolName.')
  if (!isNonEmptyString(envelope.action)) throw new Error('Integration invocation envelope is missing action.')
  if (!isNonEmptyString(envelope.idempotencyKey)) throw new Error('Integration invocation envelope is missing idempotencyKey.')
  if (envelope.metadata !== undefined && !isPlainRecord(envelope.metadata)) {
    throw new Error('Integration invocation envelope metadata must be an object.')
  }
  const parsed = parseIntegrationToolName(envelope.toolName)
  if (parsed.actionId !== envelope.action) {
    throw new Error(`Integration invocation action ${envelope.action} does not match tool ${parsed.actionId}.`)
  }
  const inputBytes = Buffer.byteLength(JSON.stringify(envelope.input ?? null), 'utf8')
  const maxInputBytes = options.maxInputBytes ?? 256 * 1024
  if (inputBytes > maxInputBytes) {
    throw new Error(`Integration invocation input exceeds ${maxInputBytes} bytes.`)
  }
  if (options.requireKnownTool || options.connectors) {
    if (!options.connectors) throw new Error('connectors are required when requireKnownTool is true.')
    const connector = options.connectors.find((candidate) =>
      candidate.providerId === parsed.providerId && candidate.id === parsed.connectorId
    )
    const action = connector?.actions.find((candidate) => candidate.id === parsed.actionId)
    if (!connector || !action) throw new Error(`Unknown integration tool ${envelope.toolName}.`)
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

export async function dispatchIntegrationInvocation(
  envelope: IntegrationInvocationEnvelope,
  options: IntegrationSandboxHostOptions,
): Promise<NormalizedIntegrationResult> {
  try {
    validateIntegrationInvocationEnvelope(envelope, options)
    const result = await options.hub.invokeWithCapability(
      envelope.capabilityToken,
      invocationRequestFromEnvelope(envelope),
    )
    return normalizeIntegrationResult(result)
  } catch (error) {
    return {
      status: 'failed',
      action: typeof envelope?.action === 'string' ? envelope.action : 'unknown',
      error: error instanceof Error ? error.message : 'Integration invocation failed.',
    }
  }
}

export class IntegrationSandboxHost {
  private readonly options: IntegrationSandboxHostOptions

  constructor(options: IntegrationSandboxHostOptions) {
    this.options = options
  }

  dispatch(envelope: IntegrationInvocationEnvelope): Promise<NormalizedIntegrationResult> {
    return dispatchIntegrationInvocation(envelope, this.options)
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
