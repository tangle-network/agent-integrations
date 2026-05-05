import type {
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationConnection,
  IntegrationConnector,
} from './index.js'
import type { IntegrationAuditSink } from './audit.js'
import { createIntegrationAuditEvent } from './audit.js'
import type { IntegrationRegistry } from './registry.js'

export type IntegrationHealthcheckStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

export interface IntegrationHealthcheckCheck {
  id: string
  status: IntegrationHealthcheckStatus
  message: string
  metadata?: Record<string, unknown>
}

export interface IntegrationHealthcheckResult {
  connectionId: string
  providerId: string
  connectorId: string
  status: IntegrationHealthcheckStatus
  checkedAt: string
  checks: IntegrationHealthcheckCheck[]
  metadata?: Record<string, unknown>
}

export interface IntegrationHealthcheckStore {
  put(result: IntegrationHealthcheckResult): Promise<void> | void
  get(connectionId: string): Promise<IntegrationHealthcheckResult | undefined> | IntegrationHealthcheckResult | undefined
  list(): Promise<IntegrationHealthcheckResult[]> | IntegrationHealthcheckResult[]
}

export class InMemoryIntegrationHealthcheckStore implements IntegrationHealthcheckStore {
  private readonly results = new Map<string, IntegrationHealthcheckResult>()

  put(result: IntegrationHealthcheckResult): void {
    this.results.set(result.connectionId, result)
  }

  get(connectionId: string): IntegrationHealthcheckResult | undefined {
    return this.results.get(connectionId)
  }

  list(): IntegrationHealthcheckResult[] {
    return [...this.results.values()]
  }
}

export async function runIntegrationHealthcheck(input: {
  connection: IntegrationConnection
  connector?: IntegrationConnector
  registry?: IntegrationRegistry
  test?: (connection: IntegrationConnection, connector: IntegrationConnector) => Promise<IntegrationActionResult | boolean> | IntegrationActionResult | boolean
  audit?: IntegrationAuditSink
  now?: () => Date
}): Promise<IntegrationHealthcheckResult> {
  const now = input.now ?? (() => new Date())
  const checkedAt = now().toISOString()
  const connector = input.connector ?? input.registry?.byId.get(input.connection.connectorId)?.connector
  const checks: IntegrationHealthcheckCheck[] = []

  checks.push(connectionStatusCheck(input.connection, now))
  if (!connector) {
    checks.push({ id: 'connector-known', status: 'unknown', message: `Connector ${input.connection.connectorId} is not in the registry.` })
  } else {
    checks.push(connectorExecutableCheck(connector))
    checks.push(scopeShapeCheck(input.connection, connector))
    if (input.test && input.connection.status === 'active') {
      checks.push(await liveHealthcheck(input.connection, connector, input.test))
    }
  }

  const result: IntegrationHealthcheckResult = {
    connectionId: input.connection.id,
    providerId: input.connection.providerId,
    connectorId: input.connection.connectorId,
    status: rollupHealthStatus(checks),
    checkedAt,
    checks,
  }
  await input.audit?.record(createIntegrationAuditEvent({
    type: 'healthcheck.completed',
    actor: input.connection.owner,
    connectionId: input.connection.id,
    providerId: input.connection.providerId,
    connectorId: input.connection.connectorId,
    ok: result.status === 'healthy',
    message: result.status,
    metadata: { checks: checks.map((check) => ({ id: check.id, status: check.status, message: check.message })) },
    occurredAt: checkedAt,
  }))
  return result
}

export async function runIntegrationHealthchecks(input: {
  connections: IntegrationConnection[]
  registry?: IntegrationRegistry
  store?: IntegrationHealthcheckStore
  audit?: IntegrationAuditSink
  now?: () => Date
  test?: (connection: IntegrationConnection, connector: IntegrationConnector) => Promise<IntegrationActionResult | boolean> | IntegrationActionResult | boolean
}): Promise<IntegrationHealthcheckResult[]> {
  const results: IntegrationHealthcheckResult[] = []
  for (const connection of input.connections) {
    const result = await runIntegrationHealthcheck({
      connection,
      registry: input.registry,
      test: input.test,
      audit: input.audit,
      now: input.now,
    })
    await input.store?.put(result)
    results.push(result)
  }
  return results
}

export function healthcheckRequest(action = 'healthcheck'): IntegrationActionRequest {
  return {
    connectionId: '__healthcheck__',
    action,
    input: {},
    dryRun: true,
    metadata: { healthcheck: true },
  }
}

function connectionStatusCheck(connection: IntegrationConnection, now: () => Date): IntegrationHealthcheckCheck {
  if (connection.status !== 'active') {
    return { id: 'connection-active', status: 'unhealthy', message: `Connection is ${connection.status}.` }
  }
  if (connection.expiresAt && Date.parse(connection.expiresAt) <= now().getTime()) {
    return { id: 'connection-active', status: 'unhealthy', message: 'Connection credentials are expired.' }
  }
  return { id: 'connection-active', status: 'healthy', message: 'Connection is active.' }
}

function connectorExecutableCheck(connector: IntegrationConnector): IntegrationHealthcheckCheck {
  const executable = connector.actions.length > 0 || (connector.triggers?.length ?? 0) > 0
  if (!executable) {
    return { id: 'connector-executable', status: 'degraded', message: `${connector.title} is catalog-only.` }
  }
  return { id: 'connector-executable', status: 'healthy', message: `${connector.title} has executable actions or triggers.` }
}

function scopeShapeCheck(connection: IntegrationConnection, connector: IntegrationConnector): IntegrationHealthcheckCheck {
  const declaredScopes = new Set(connector.scopes)
  const undeclared = connection.grantedScopes.filter((scope) => !declaredScopes.has(scope))
  if (connector.scopes.length === 0 && connection.grantedScopes.length > 0) {
    return { id: 'scope-shape', status: 'unknown', message: 'Connector does not declare a scope catalog.', metadata: { grantedScopes: connection.grantedScopes } }
  }
  if (undeclared.length > 0) {
    return { id: 'scope-shape', status: 'degraded', message: 'Connection has scopes not declared by the connector.', metadata: { undeclared } }
  }
  return { id: 'scope-shape', status: 'healthy', message: 'Granted scopes match the connector shape.' }
}

async function liveHealthcheck(
  connection: IntegrationConnection,
  connector: IntegrationConnector,
  test: (connection: IntegrationConnection, connector: IntegrationConnector) => Promise<IntegrationActionResult | boolean> | IntegrationActionResult | boolean,
): Promise<IntegrationHealthcheckCheck> {
  try {
    const result = await test(connection, connector)
    const ok = typeof result === 'boolean' ? result : result.ok
    return {
      id: 'provider-live-test',
      status: ok ? 'healthy' : 'unhealthy',
      message: ok ? 'Provider live test passed.' : 'Provider live test failed.',
      metadata: typeof result === 'boolean' ? undefined : { action: result.action, warnings: result.warnings },
    }
  } catch (error) {
    return {
      id: 'provider-live-test',
      status: 'unhealthy',
      message: error instanceof Error ? error.message : 'Provider live test failed.',
    }
  }
}

function rollupHealthStatus(checks: IntegrationHealthcheckCheck[]): IntegrationHealthcheckStatus {
  if (checks.some((check) => check.status === 'unhealthy')) return 'unhealthy'
  if (checks.some((check) => check.status === 'degraded')) return 'degraded'
  if (checks.some((check) => check.status === 'unknown')) return 'unknown'
  return 'healthy'
}
