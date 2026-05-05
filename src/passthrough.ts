import { CANONICAL_INTEGRATION_ACTIONS } from './actions.js'
import { IntegrationRuntimeError } from './errors.js'

export interface ProviderHttpRequestInput {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  body?: unknown
}

export interface ProviderPassthroughPolicy {
  enabled: boolean
  allowedMethods?: ProviderHttpRequestInput['method'][]
  allowedPathPrefixes?: string[]
  maxBodyBytes?: number
}

export const PROVIDER_PASSTHROUGH_ACTION = CANONICAL_INTEGRATION_ACTIONS.providerHttpRequest

export function validateProviderPassthroughRequest(
  input: ProviderHttpRequestInput,
  policy: ProviderPassthroughPolicy,
): void {
  if (!policy.enabled) {
    throw new IntegrationRuntimeError({
      code: 'passthrough_disabled',
      message: 'Provider-native passthrough is disabled for this connector.',
    })
  }
  if (!input.path.startsWith('/')) {
    throw new IntegrationRuntimeError({ code: 'input_invalid', message: 'Provider passthrough path must start with /.' })
  }
  if (policy.allowedMethods?.length && !policy.allowedMethods.includes(input.method)) {
    throw new IntegrationRuntimeError({ code: 'action_denied', message: `Provider passthrough method ${input.method} is not allowed.` })
  }
  if (policy.allowedPathPrefixes?.length && !policy.allowedPathPrefixes.some((prefix) => input.path.startsWith(prefix))) {
    throw new IntegrationRuntimeError({ code: 'action_denied', message: `Provider passthrough path ${input.path} is not allowed.` })
  }
  const maxBodyBytes = policy.maxBodyBytes ?? 64 * 1024
  const bodyBytes = Buffer.byteLength(JSON.stringify(input.body ?? null), 'utf8')
  if (bodyBytes > maxBodyBytes) {
    throw new IntegrationRuntimeError({ code: 'input_invalid', message: `Provider passthrough body exceeds ${maxBodyBytes} bytes.` })
  }
  for (const key of Object.keys(input.headers ?? {})) {
    if (/authorization|cookie|token|secret|api[_-]?key/i.test(key)) {
      throw new IntegrationRuntimeError({ code: 'input_invalid', message: `Provider passthrough header ${key} is not caller-settable.` })
    }
  }
}
