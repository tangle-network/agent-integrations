export type IntegrationErrorCode =
  | 'missing_connection'
  | 'missing_grant'
  | 'approval_required'
  | 'approval_denied'
  | 'connection_revoked'
  | 'connection_expired'
  | 'scope_missing'
  | 'action_denied'
  | 'action_not_found'
  | 'trigger_not_found'
  | 'provider_rate_limited'
  | 'provider_auth_failed'
  | 'provider_unavailable'
  | 'provider_error'
  | 'capability_expired'
  | 'capability_invalid'
  | 'manifest_invalid'
  | 'passthrough_disabled'
  | 'input_invalid'
  | 'unknown'

export interface IntegrationUserAction {
  type: 'connect' | 'reconnect' | 'approve' | 'retry' | 'contact_support' | 'change_request'
  label: string
  connectorId?: string
  approvalId?: string
}

export class IntegrationRuntimeError extends Error {
  readonly code: IntegrationErrorCode
  readonly status: number
  readonly userAction?: IntegrationUserAction
  readonly metadata?: Record<string, unknown>

  constructor(input: {
    code: IntegrationErrorCode
    message: string
    status?: number
    userAction?: IntegrationUserAction
    metadata?: Record<string, unknown>
  }) {
    super(input.message)
    this.name = 'IntegrationRuntimeError'
    this.code = input.code
    this.status = input.status ?? statusForCode(input.code)
    this.userAction = input.userAction
    this.metadata = input.metadata
  }
}

export interface NormalizedIntegrationError {
  ok: false
  code: IntegrationErrorCode
  message: string
  status: number
  userAction?: IntegrationUserAction
  metadata?: Record<string, unknown>
}

export function normalizeIntegrationError(error: unknown): NormalizedIntegrationError {
  if (error instanceof IntegrationRuntimeError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      status: error.status,
      userAction: error.userAction,
      metadata: redactUnknown(error.metadata) as Record<string, unknown> | undefined,
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown integration error.')
  return {
    ok: false,
    code: inferCode(message),
    message,
    status: 500,
  }
}

export function statusForCode(code: IntegrationErrorCode): number {
  if (code === 'missing_connection' || code === 'missing_grant') return 409
  if (code === 'approval_required') return 202
  if (code === 'approval_denied') return 403
  if (code === 'connection_revoked' || code === 'connection_expired' || code === 'provider_auth_failed') return 401
  if (code === 'scope_missing' || code === 'action_denied' || code === 'passthrough_disabled') return 403
  if (code === 'action_not_found' || code === 'trigger_not_found' || code === 'manifest_invalid' || code === 'input_invalid') return 400
  if (code === 'provider_rate_limited') return 429
  if (code === 'provider_unavailable') return 503
  if (code === 'capability_expired' || code === 'capability_invalid') return 401
  return 500
}

function inferCode(message: string): IntegrationErrorCode {
  if (/approval/i.test(message)) return 'approval_required'
  if (/scope/i.test(message)) return 'scope_missing'
  if (/expired/i.test(message)) return 'connection_expired'
  if (/revoked/i.test(message)) return 'connection_revoked'
  if (/rate.?limit|429/i.test(message)) return 'provider_rate_limited'
  if (/unauth|forbidden|401|403/i.test(message)) return 'provider_auth_failed'
  return 'unknown'
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
