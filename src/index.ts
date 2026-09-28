import { IntegrationError } from './core-error.js'
import type {
  CompleteAuthRequest,
  HttpIntegrationProviderOptions,
  IntegrationActionGuard,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationActor,
  IntegrationCapability,
  IntegrationConnection,
  IntegrationConnectionStore,
  IntegrationConnector,
  IntegrationHubOptions,
  IntegrationPolicyEngine,
  IntegrationProvider,
  IntegrationTriggerEvent,
  IntegrationTriggerSubscription,
  InvokeWithCapabilityRequest,
  IssueCapabilityRequest,
  IssuedIntegrationCapability,
  StartAuthRequest,
  StartAuthResult,
} from './core-types.js'

export * from './core-types.js'
export * from './core-error.js'
export * from './audit.js'
export * from './approval.js'
export * from './actions.js'
export * from './bridge.js'
export * from './billing-access-policy.js'
export * from './idempotency.js'
export * from './apps.js'
export * from './client.js'
export * from './consumer.js'
export * from './consent.js'
export * from './credentials.js'
export * from './discovery.js'
export * from './errors.js'
export * from './events.js'
export * from './guard.js'
export * from './healthcheck.js'
export * from './manifest.js'
export * from './passthrough.js'
export * from './presets.js'
export * from './connect/index.js'
export * from './middleware/index.js'

export class InMemoryConnectionStore implements IntegrationConnectionStore {
  private readonly connections = new Map<string, IntegrationConnection>()

  get(connectionId: string): IntegrationConnection | undefined {
    return this.connections.get(connectionId)
  }

  put(connection: IntegrationConnection): void {
    this.connections.set(connection.id, connection)
  }

  listByOwner(owner: IntegrationActor): IntegrationConnection[] {
    return [...this.connections.values()].filter((connection) =>
      connection.owner.type === owner.type && connection.owner.id === owner.id,
    )
  }

  delete(connectionId: string): void {
    this.connections.delete(connectionId)
  }
}


export function sanitizeConnection(connection: IntegrationConnection): Record<string, unknown> {
  return {
    id: connection.id,
    owner: connection.owner,
    providerId: connection.providerId,
    connectorId: connection.connectorId,
    status: connection.status,
    grantedScopes: connection.grantedScopes,
    account: connection.account,
    hasSecretRef: Boolean(connection.secretRef),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    expiresAt: connection.expiresAt,
    lastUsedAt: connection.lastUsedAt,
  }
}

export function createMockIntegrationProvider(options: {
  id?: string
  connectors?: IntegrationConnector[]
  onInvoke?: (connection: IntegrationConnection, request: IntegrationActionRequest) => IntegrationActionResult | Promise<IntegrationActionResult>
} = {}): IntegrationProvider {
  const providerId = options.id ?? 'mock'
  const connectors = options.connectors ?? [{
    id: 'gmail',
    providerId,
    title: 'Gmail',
    category: 'email',
    auth: 'oauth2',
    scopes: ['email.read', 'email.write'],
    actions: [
      { id: 'messages.search', title: 'Search messages', risk: 'read', requiredScopes: ['email.read'], dataClass: 'private' },
      { id: 'drafts.create', title: 'Create draft', risk: 'write', requiredScopes: ['email.write'], dataClass: 'private', approvalRequired: true },
    ],
    triggers: [
      { id: 'message.received', title: 'Message received', requiredScopes: ['email.read'], dataClass: 'private' },
    ],
  }]
  return {
    id: providerId,
    kind: 'custom',
    listConnectors: () => connectors,
    startAuth: (request) => ({
      providerId,
      connectorId: request.connectorId,
      authUrl: `https://auth.example.test/${request.connectorId}?state=${encodeURIComponent(request.state ?? 'state')}`,
      state: request.state ?? 'state',
    }),
    completeAuth: (request) => ({
      id: `conn_${request.connectorId}_${request.owner.id}`,
      owner: request.owner,
      providerId,
      connectorId: request.connectorId,
      status: 'active',
      grantedScopes: connectors.find((connector) => connector.id === request.connectorId)?.scopes ?? [],
      secretRef: { provider: providerId, id: `secret_${request.owner.id}` },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    invokeAction: async (connection, request) => options.onInvoke?.(connection, request) ?? ({
      ok: true,
      action: request.action,
      output: { echo: request.input ?? null },
    }),
    subscribeTrigger: (connection, trigger, targetUrl) => ({
      id: `sub_${connection.id}_${trigger}`,
      connectionId: connection.id,
      trigger,
      targetUrl,
      status: 'active',
      createdAt: new Date(0).toISOString(),
    }),
  }
}

export function createHttpIntegrationProvider(options: HttpIntegrationProviderOptions): IntegrationProvider {
  const fetcher = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  return {
    id: options.id,
    kind: options.kind ?? 'custom',
    listConnectors: () => options.connectors,
    async startAuth(request) {
      const response = await postJson<StartAuthResult>(fetcher, `${baseUrl}/auth/start`, request, options.bearer)
      return response
    },
    async completeAuth(request) {
      const response = await postJson<IntegrationConnection>(fetcher, `${baseUrl}/auth/complete`, request, options.bearer)
      return response
    },
    async invokeAction(connection, request) {
      return postJson<IntegrationActionResult>(fetcher, `${baseUrl}/actions/invoke`, {
        connection,
        request,
      }, options.bearer)
    },
    async subscribeTrigger(connection, trigger, targetUrl) {
      return postJson<IntegrationTriggerSubscription>(fetcher, `${baseUrl}/triggers/subscribe`, {
        connection,
        trigger,
        targetUrl,
      }, options.bearer)
    },
    async unsubscribeTrigger(subscriptionId) {
      await postJson(fetcher, `${baseUrl}/triggers/unsubscribe`, { subscriptionId }, options.bearer)
    },
    async normalizeTriggerEvent(raw) {
      return postJson<IntegrationTriggerEvent>(fetcher, `${baseUrl}/triggers/normalize`, { raw }, options.bearer)
    },
  }
}


async function postJson<T = unknown>(
  fetcher: typeof fetch,
  url: string,
  body: unknown,
  bearer?: string,
): Promise<T> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new IntegrationError(`Integration provider returned HTTP ${response.status}.`, 'provider_not_found')
  return response.json() as Promise<T>
}



// ─── Connectors namespace ───────────────────────────────────────────────
//
// Lower-level adapter primitives — the contract a concrete first-party
// integration (Google Calendar, HubSpot, Stripe, ...) implements. The
// hub-side `IntegrationProvider` interface is the *catalog* facade above
// these; one provider can wrap many connectors. See `src/connectors/types.ts`
// for the layering details.
export { IntegrationHub, signCapability, verifyCapabilityToken } from './hub.js'
export * from './connectors/index.js'
export * from './catalog.js'
export * from './catalog-executor.js'
export * from './policy.js'
export * from './sandbox.js'
export * from './adapter-provider.js'
export * from './importers.js'
export * from './gateway-catalog.js'
export * from './activepieces-catalog.js'
export * from './activepieces-overrides.js'
export * from './activepieces-provider.js'
export * from './tangle-catalog.js'
export * from './catalog-freshness.js'
export * from './registry.js'
export * from './runtime.js'
export * from './workflow.js'
export * from './coverage-catalog.js'
export * from './integration-kind-aliases.js'
export * from './specs/index.js'
