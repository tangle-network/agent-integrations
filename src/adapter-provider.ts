import type {
  CapabilityMutationResult,
  CapabilityReadResult,
  ConnectorAdapter,
  ConnectorInvocation,
  ResolvedDataSource,
} from './connectors/types.js'
import type {
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationConnection,
  IntegrationConnector,
  IntegrationProvider,
  IntegrationProviderKind,
} from './index.js'
import { IntegrationError } from './index.js'

export interface ConnectorAdapterProviderOptions {
  id?: string
  kind?: IntegrationProviderKind
  adapters: ConnectorAdapter[]
  resolveDataSource: (connection: IntegrationConnection) => Promise<ResolvedDataSource> | ResolvedDataSource
  now?: () => Date
}

export function createConnectorAdapterProvider(options: ConnectorAdapterProviderOptions): IntegrationProvider {
  const providerId = options.id ?? 'first-party'
  const now = options.now ?? (() => new Date())
  const adapters = new Map<string, ConnectorAdapter>()
  for (const adapter of options.adapters) {
    adapters.set(adapter.manifest.kind, adapter)
  }
  return {
    id: providerId,
    kind: options.kind ?? 'first_party',
    listConnectors: () => [...adapters.values()].map((adapter) => manifestToConnector(providerId, adapter)),
    async invokeAction(connection, request) {
      const adapter = adapters.get(connection.connectorId)
      if (!adapter) {
        throw new IntegrationError(`Connector adapter ${connection.connectorId} not found.`, 'connector_not_found')
      }
      const capability = adapter.manifest.capabilities.find((candidate) => candidate.name === request.action)
      if (!capability) {
        throw new IntegrationError(`Capability ${request.action} is not defined by ${connection.connectorId}.`, 'action_not_found')
      }
      const source = await options.resolveDataSource(connection)
      const invocation: ConnectorInvocation = {
        source,
        capabilityName: request.action,
        args: toRecord(request.input),
        idempotencyKey: request.idempotencyKey ?? `idem_${connection.id}_${request.action}_${now().getTime()}`,
        expectedEtag: typeof request.metadata?.expectedEtag === 'string' ? request.metadata.expectedEtag : undefined,
        callSessionId: typeof request.metadata?.callSessionId === 'string' ? request.metadata.callSessionId : undefined,
      }
      if (capability.class === 'read') {
        if (!adapter.executeRead) {
          throw new IntegrationError(`Connector ${connection.connectorId} does not implement reads.`, 'action_not_found')
        }
        const result = await adapter.executeRead(invocation)
        return readResultToAction(request, result)
      }
      if (capability.class === 'mutation') {
        if (!adapter.executeMutation) {
          throw new IntegrationError(`Connector ${connection.connectorId} does not implement mutations.`, 'action_not_found')
        }
        const result = await adapter.executeMutation(invocation)
        return mutationResultToAction(request, result)
      }
      throw new IntegrationError(`Capability ${request.action} is not invokable as an action.`, 'action_not_found')
    },
  }
}

export function manifestToConnector(providerId: string, adapter: ConnectorAdapter): IntegrationConnector {
  const manifest = adapter.manifest
  return {
    id: manifest.kind,
    providerId,
    title: manifest.displayName,
    category: mapCategory(manifest.category),
    auth: mapAuth(manifest.auth.kind),
    scopes: manifest.auth.kind === 'oauth2' ? manifest.auth.scopes : [],
    actions: manifest.capabilities
      .filter((capability) => capability.class === 'read' || capability.class === 'mutation')
      .map((capability) => ({
        id: capability.name,
        title: titleFromName(capability.name),
        risk: capability.class === 'read' ? 'read' : capability.externalEffect ? 'destructive' : 'write',
        requiredScopes: capability.requiredScopes ?? [],
        dataClass: inferDataClass(manifest.category),
        description: capability.description,
        approvalRequired: capability.class === 'mutation',
        inputSchema: capability.parameters,
      })),
    metadata: {
      source: 'first-party-adapter',
      supportTier: 'firstPartyExecutable',
      executable: true,
    },
  }
}

function readResultToAction(request: IntegrationActionRequest, result: CapabilityReadResult): IntegrationActionResult {
  return {
    ok: true,
    action: request.action,
    output: result.data,
    metadata: {
      etag: result.etag,
      fetchedAt: result.fetchedAt,
    },
  }
}

function mutationResultToAction(request: IntegrationActionRequest, result: CapabilityMutationResult): IntegrationActionResult {
  if (result.status === 'committed') {
    return {
      ok: true,
      action: request.action,
      output: result.data,
      metadata: {
        etagAfter: result.etagAfter,
        committedAt: result.committedAt,
        idempotentReplay: result.idempotentReplay,
      },
    }
  }
  if (result.status === 'conflict') {
    return {
      ok: false,
      action: request.action,
      output: {
        conflict: true,
        message: result.message,
        alternatives: result.alternatives,
        currentState: result.currentState,
      },
    }
  }
  return {
    ok: false,
    action: request.action,
    output: {
      rateLimited: true,
      retryAfterMs: result.retryAfterMs,
      message: result.message,
    },
  }
}

function mapAuth(kind: ConnectorAdapter['manifest']['auth']['kind']): IntegrationConnector['auth'] {
  if (kind === 'oauth2') return 'oauth2'
  if (kind === 'api-key') return 'api_key'
  if (kind === 'none') return 'none'
  return 'custom'
}

function mapCategory(category: ConnectorAdapter['manifest']['category']): IntegrationConnector['category'] {
  if (category === 'comms') return 'chat'
  if (category === 'spreadsheet') return 'database'
  if (category === 'doc') return 'docs'
  if (category === 'commerce') return 'workflow'
  return category === 'other' ? 'other' : category
}

function inferDataClass(category: ConnectorAdapter['manifest']['category']): 'public' | 'internal' | 'private' | 'sensitive' {
  if (category === 'commerce') return 'sensitive'
  if (category === 'webhook') return 'internal'
  return 'private'
}

function titleFromName(name: string): string {
  return name
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

function toRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>
  return {}
}
