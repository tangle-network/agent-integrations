import {
  DEFAULT_INTEGRATION_BRIDGE_ENV,
  parseIntegrationBridgeEnvironment,
  type IntegrationBridgePayload,
  type IntegrationBridgeToolBinding,
} from './bridge.js'
import { IntegrationRuntimeError, normalizeIntegrationError } from './errors.js'

export interface TangleIntegrationsClientOptions {
  endpoint: string
  bridge?: IntegrationBridgePayload
  env?: Record<string, string | undefined>
  envVar?: string
  fetchImpl?: typeof fetch
  getCapabilityToken?: (tool: IntegrationBridgeToolBinding) => string | Promise<string>
}

export interface TangleIntegrationInvokeInput<TInput = unknown> {
  tool: string
  input?: TInput
  idempotencyKey?: string
  dryRun?: boolean
  metadata?: Record<string, unknown>
}

export interface TangleIntegrationInvokeResult<TOutput = unknown> {
  status: 'ok' | 'approval_required' | 'failed'
  action: string
  output?: TOutput
  approval?: unknown
  error?: string
  metadata?: Record<string, unknown>
}

export class TangleIntegrationsClient {
  private readonly endpoint: string
  private readonly bridge: IntegrationBridgePayload
  private readonly fetchImpl: typeof fetch
  private readonly getCapabilityToken: (tool: IntegrationBridgeToolBinding) => string | Promise<string>

  constructor(options: TangleIntegrationsClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '')
    this.bridge = options.bridge ?? parseIntegrationBridgeEnvironment(
      options.env ?? readProcessEnv(),
      { envVar: options.envVar ?? DEFAULT_INTEGRATION_BRIDGE_ENV },
    )
    this.fetchImpl = options.fetchImpl ?? fetch
    this.getCapabilityToken = options.getCapabilityToken ?? ((tool) => tool.capabilityToken)
  }

  tools(): IntegrationBridgeToolBinding[] {
    return [...this.bridge.tools]
  }

  findTool(toolOrAction: string): IntegrationBridgeToolBinding {
    const found = this.bridge.tools.find((tool) =>
      tool.name === toolOrAction ||
      tool.action === toolOrAction ||
      `${tool.connectorId}.${tool.action}` === toolOrAction
    )
    if (!found) {
      throw new IntegrationRuntimeError({
        code: 'action_not_found',
        message: `Integration tool ${toolOrAction} is not available in this runtime.`,
        metadata: { available: this.bridge.tools.map((tool) => ({ name: tool.name, action: tool.action, connectorId: tool.connectorId })) },
      })
    }
    return found
  }

  async invoke<TOutput = unknown, TInput = unknown>(input: TangleIntegrationInvokeInput<TInput>): Promise<TangleIntegrationInvokeResult<TOutput>> {
    try {
      const tool = this.findTool(input.tool)
      const token = await this.getCapabilityToken(tool)
      const response = await this.fetchImpl(`${this.endpoint}/v1/integrations/invoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: tool.action,
          input: input.input,
          idempotencyKey: input.idempotencyKey ?? defaultIdempotencyKey(tool.action),
          dryRun: input.dryRun,
          metadata: input.metadata,
        }),
      })
      const json = await response.json().catch(() => undefined) as TangleIntegrationInvokeResult<TOutput> | undefined
      if (!response.ok && !json) {
        return { status: 'failed', action: tool.action, error: `Integration invoke failed with HTTP ${response.status}` }
      }
      return json ?? { status: 'failed', action: tool.action, error: 'Integration invoke returned an empty response.' }
    } catch (error) {
      const normalized = normalizeIntegrationError(error)
      return { status: 'failed', action: input.tool, error: normalized.message, metadata: { code: normalized.code, userAction: normalized.userAction } }
    }
  }
}

export function createTangleIntegrationsClient(options: TangleIntegrationsClientOptions): TangleIntegrationsClient {
  return new TangleIntegrationsClient(options)
}

function defaultIdempotencyKey(action: string): string {
  return `${action}:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

function readProcessEnv(): Record<string, string | undefined> {
  if (typeof process !== 'undefined' && process.env) return process.env
  return {}
}
