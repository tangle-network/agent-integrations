import type { IntegrationSandboxBundle } from './runtime.js'

export const DEFAULT_INTEGRATION_BRIDGE_ENV = 'TANGLE_INTEGRATION_BUNDLE'

export interface IntegrationBridgePayload {
  version: 1
  manifestId: string
  subject: IntegrationSandboxBundle['subject']
  expiresAt: string
  tools: IntegrationBridgeToolBinding[]
}

export interface IntegrationBridgeToolBinding {
  name: string
  title: string
  connectorId: string
  connectionId: string
  action: string
  risk: string
  dataClass: string
  requiredScopes: string[]
  capabilityToken: string
}

export function buildIntegrationBridgePayload(bundle: IntegrationSandboxBundle): IntegrationBridgePayload {
  return {
    version: 1,
    manifestId: bundle.manifestId,
    subject: bundle.subject,
    expiresAt: bundle.expiresAt,
    tools: bundle.tools.flatMap((tool) => {
      const binding = bundle.capabilities.find((candidate) =>
        candidate.connectorId === tool.connectorId
        && candidate.connectionId
        && candidate.allowedActions.includes(tool.action.id)
      )
      if (!binding) return []
      return [{
        name: tool.name,
        title: tool.title,
        connectorId: tool.connectorId,
        connectionId: binding.connectionId,
        action: tool.action.id,
        risk: tool.risk,
        dataClass: tool.dataClass,
        requiredScopes: tool.requiredScopes,
        capabilityToken: binding.capability.token,
      }]
    }),
  }
}

export function encodeIntegrationBridgePayload(payload: IntegrationBridgePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeIntegrationBridgePayload(encoded: string): IntegrationBridgePayload {
  const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown
  assertBridgePayload(parsed)
  return parsed
}

export function buildIntegrationBridgeEnvironment(
  bundle: IntegrationSandboxBundle,
  options: { envVar?: string } = {},
): Record<string, string> {
  const envVar = options.envVar ?? DEFAULT_INTEGRATION_BRIDGE_ENV
  return {
    [envVar]: encodeIntegrationBridgePayload(buildIntegrationBridgePayload(bundle)),
  }
}

export function parseIntegrationBridgeEnvironment(
  env: Record<string, string | undefined>,
  options: { envVar?: string } = {},
): IntegrationBridgePayload {
  const envVar = options.envVar ?? DEFAULT_INTEGRATION_BRIDGE_ENV
  const encoded = env[envVar]
  if (!encoded) throw new Error(`Missing ${envVar}.`)
  return decodeIntegrationBridgePayload(encoded)
}

export function redactIntegrationBridgePayload(payload: IntegrationBridgePayload): IntegrationBridgePayload {
  return {
    ...payload,
    tools: payload.tools.map((tool) => ({
      ...tool,
      capabilityToken: '[REDACTED]',
    })),
  }
}

function assertBridgePayload(value: unknown): asserts value is IntegrationBridgePayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid integration bridge payload.')
  const payload = value as Partial<IntegrationBridgePayload>
  if (payload.version !== 1) throw new Error('Unsupported integration bridge payload version.')
  if (typeof payload.manifestId !== 'string') throw new Error('Invalid integration bridge manifestId.')
  if (typeof payload.expiresAt !== 'string') throw new Error('Invalid integration bridge expiresAt.')
  if (!Array.isArray(payload.tools)) throw new Error('Invalid integration bridge tools.')
}
