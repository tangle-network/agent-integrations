import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export type IntegrationProviderKind =
  | 'first_party'
  | 'nango'
  | 'pipedream'
  | 'zapier'
  | 'activepieces'
  | 'executor'
  | 'custom'

export type IntegrationConnectorCategory =
  | 'email'
  | 'calendar'
  | 'chat'
  | 'crm'
  | 'storage'
  | 'docs'
  | 'database'
  | 'webhook'
  | 'workflow'
  | 'internal'
  | 'other'

export type IntegrationActionRisk = 'read' | 'write' | 'destructive'
export type IntegrationDataClass = 'public' | 'internal' | 'private' | 'sensitive' | 'secret'

export interface IntegrationActor {
  type: 'user' | 'team' | 'agent' | 'sandbox' | 'system'
  id: string
}

export interface IntegrationConnectorAction {
  id: string
  title: string
  risk: IntegrationActionRisk
  requiredScopes: string[]
  dataClass: IntegrationDataClass
  description?: string
  approvalRequired?: boolean
  inputSchema?: unknown
  outputSchema?: unknown
}

export interface IntegrationConnectorTrigger {
  id: string
  title: string
  requiredScopes: string[]
  dataClass: IntegrationDataClass
  description?: string
  payloadSchema?: unknown
}

export interface IntegrationConnector {
  id: string
  providerId: string
  title: string
  category: IntegrationConnectorCategory
  auth: 'oauth2' | 'api_key' | 'none' | 'custom'
  scopes: string[]
  actions: IntegrationConnectorAction[]
  triggers?: IntegrationConnectorTrigger[]
  metadata?: Record<string, unknown>
}

export interface SecretRef {
  provider: string
  id: string
  label?: string
}

export interface IntegrationConnection {
  id: string
  owner: IntegrationActor
  providerId: string
  connectorId: string
  status: 'pending' | 'active' | 'expired' | 'revoked' | 'error'
  grantedScopes: string[]
  account?: {
    id?: string
    email?: string
    displayName?: string
  }
  secretRef?: SecretRef
  createdAt: string
  updatedAt: string
  expiresAt?: string
  lastUsedAt?: string
  metadata?: Record<string, unknown>
}

export interface StartAuthRequest {
  connectorId: string
  owner: IntegrationActor
  requestedScopes: string[]
  redirectUri: string
  state?: string
  metadata?: Record<string, unknown>
}

export interface StartAuthResult {
  providerId: string
  connectorId: string
  authUrl: string
  state: string
  expiresAt?: string
  metadata?: Record<string, unknown>
}

export interface CompleteAuthRequest {
  connectorId: string
  owner: IntegrationActor
  code?: string
  state: string
  redirectUri: string
  metadata?: Record<string, unknown>
}

export interface IntegrationActionRequest {
  connectionId: string
  action: string
  input?: unknown
  idempotencyKey?: string
  dryRun?: boolean
  metadata?: Record<string, unknown>
}

export interface IntegrationActionResult<T = unknown> {
  ok: boolean
  action: string
  output?: T
  externalId?: string
  warnings?: string[]
  metadata?: Record<string, unknown>
}

export interface IntegrationTriggerSubscription {
  id: string
  connectionId: string
  trigger: string
  targetUrl?: string
  status: 'active' | 'paused' | 'error'
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface IntegrationTriggerEvent<T = unknown> {
  id: string
  providerId: string
  connectorId: string
  connectionId: string
  trigger: string
  occurredAt: string
  payload: T
  metadata?: Record<string, unknown>
}

export interface IntegrationProvider {
  id: string
  kind: IntegrationProviderKind
  listConnectors(): Promise<IntegrationConnector[]> | IntegrationConnector[]
  startAuth?(request: StartAuthRequest): Promise<StartAuthResult> | StartAuthResult
  completeAuth?(request: CompleteAuthRequest): Promise<IntegrationConnection> | IntegrationConnection
  invokeAction(connection: IntegrationConnection, request: IntegrationActionRequest): Promise<IntegrationActionResult> | IntegrationActionResult
  subscribeTrigger?(connection: IntegrationConnection, trigger: string, targetUrl?: string): Promise<IntegrationTriggerSubscription> | IntegrationTriggerSubscription
  unsubscribeTrigger?(subscriptionId: string): Promise<void> | void
  normalizeTriggerEvent?(raw: unknown): Promise<IntegrationTriggerEvent> | IntegrationTriggerEvent
}

export interface IntegrationConnectionStore {
  get(connectionId: string): Promise<IntegrationConnection | undefined> | IntegrationConnection | undefined
  put(connection: IntegrationConnection): Promise<void> | void
  listByOwner(owner: IntegrationActor): Promise<IntegrationConnection[]> | IntegrationConnection[]
  delete?(connectionId: string): Promise<void> | void
}

export interface IssueCapabilityRequest {
  subject: IntegrationActor
  connectionId: string
  scopes: string[]
  allowedActions: string[]
  ttlMs: number
  metadata?: Record<string, unknown>
}

export interface IntegrationCapability {
  id: string
  subject: IntegrationActor
  connectionId: string
  scopes: string[]
  allowedActions: string[]
  issuedAt: string
  expiresAt: string
  metadata?: Record<string, unknown>
}

export interface IssuedIntegrationCapability {
  capability: IntegrationCapability
  token: string
}

/**
 * Wraps every action invocation with cross-cutting discipline (idempotency,
 * conflict detection, rate-limiting, audit logging). Optional. When set on
 * the hub, runs BEFORE provider.invokeAction; can short-circuit (return a
 * result directly) or pass through (call `proceed()` to invoke the provider).
 *
 * Why this hook exists: production deployments need conflict-resolution
 * guarantees that span every provider — first-party, Nango, Composio,
 * webhook receivers — and providers shouldn't re-implement them. The
 * canonical implementation is a "MutationGuard" that:
 *   1. Short-circuits on a known idempotency key (returns recorded response).
 *   2. Refuses same-key-different-args (drift detection).
 *   3. Wraps `proceed()` and audit-logs the outcome.
 *   4. Translates upstream conflict signals into a structured result with
 *      alternatives the agent can act on.
 *
 * Implementations live in consumers (every product has different
 * persistence + telemetry needs); this interface is the contract.
 */
export interface IntegrationActionGuard {
  /** Wrap an invokeAction call. Implementations MUST call `proceed()` to
   *  invoke the underlying provider unless they're returning a cached or
   *  short-circuited result.
   *
   *  @param ctx connection + request the hub is about to dispatch
   *  @param proceed call to invoke the wrapped provider; returns the
   *                 underlying IntegrationActionResult
   *  @returns the result the hub should return to the caller
   */
  invokeAction(
    ctx: IntegrationGuardContext,
    proceed: () => Promise<IntegrationActionResult>,
  ): Promise<IntegrationActionResult>
}

export interface IntegrationGuardContext {
  connection: IntegrationConnection
  request: IntegrationActionRequest
  /** The action descriptor from the connector manifest, if discovered. */
  action?: IntegrationConnectorAction
}

export type IntegrationPolicyDecision =
  | { decision: 'allow'; reason: string; metadata?: Record<string, unknown> }
  | { decision: 'require_approval'; reason: string; approval: IntegrationApprovalRequest; metadata?: Record<string, unknown> }
  | { decision: 'deny'; reason: string; metadata?: Record<string, unknown> }

export interface IntegrationApprovalRequest {
  id: string
  connectionId: string
  providerId: string
  connectorId: string
  action: string
  actor: IntegrationActor
  risk: IntegrationActionRisk
  dataClass: IntegrationDataClass
  reason: string
  requestedAt: string
  inputPreview?: unknown
  metadata?: Record<string, unknown>
}

export interface IntegrationPolicyEngine {
  decide(ctx: IntegrationGuardContext & { subject: IntegrationActor }): Promise<IntegrationPolicyDecision> | IntegrationPolicyDecision
}

export interface IntegrationHubOptions {
  providers: IntegrationProvider[]
  store: IntegrationConnectionStore
  capabilitySecret: string
  /** Optional cross-cutting guard. If provided, every invokeAction call
   *  passes through it before reaching the provider. See {@link IntegrationActionGuard}. */
  guard?: IntegrationActionGuard
  /** Optional policy engine. Runs after capability/scope checks and before
   *  provider invocation. Use it to pause writes, deny destructive actions,
   *  or apply tenant-specific allow rules. */
  policy?: IntegrationPolicyEngine
  now?: () => Date
}

export interface HttpIntegrationProviderOptions {
  id: string
  kind?: IntegrationProviderKind
  connectors: IntegrationConnector[]
  baseUrl: string
  bearer?: string
  fetchImpl?: typeof fetch
}

export interface InvokeWithCapabilityRequest extends Omit<IntegrationActionRequest, 'connectionId'> {
  connectionId?: never
}

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'provider_not_found'
      | 'connector_not_found'
      | 'connection_not_found'
      | 'connection_not_active'
      | 'auth_not_supported'
      | 'capability_invalid'
      | 'capability_expired'
      | 'scope_denied'
      | 'action_denied'
      | 'action_not_found'
      | 'approval_required'
      | 'policy_denied',
  ) {
    super(message)
    this.name = 'IntegrationError'
  }
}

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

export class IntegrationHub {
  private readonly providers = new Map<string, IntegrationProvider>()
  private readonly store: IntegrationConnectionStore
  private readonly capabilitySecret: string
  private readonly guard: IntegrationActionGuard | undefined
  private readonly policy: IntegrationPolicyEngine | undefined
  private readonly now: () => Date

  constructor(options: IntegrationHubOptions) {
    if (!options.capabilitySecret) {
      throw new IntegrationError('capabilitySecret is required.', 'capability_invalid')
    }
    for (const provider of options.providers) this.providers.set(provider.id, provider)
    this.store = options.store
    this.capabilitySecret = options.capabilitySecret
    this.guard = options.guard
    this.policy = options.policy
    this.now = options.now ?? (() => new Date())
  }

  async listConnectors(): Promise<IntegrationConnector[]> {
    const catalogs = await Promise.all([...this.providers.values()].map((provider) => provider.listConnectors()))
    return catalogs.flat()
  }

  async startAuth(providerId: string, request: StartAuthRequest): Promise<StartAuthResult> {
    const provider = this.requireProvider(providerId)
    if (!provider.startAuth) throw new IntegrationError(`Provider ${providerId} does not support auth start.`, 'auth_not_supported')
    await this.requireConnector(provider, request.connectorId)
    return provider.startAuth(request)
  }

  async completeAuth(providerId: string, request: CompleteAuthRequest): Promise<IntegrationConnection> {
    const provider = this.requireProvider(providerId)
    if (!provider.completeAuth) throw new IntegrationError(`Provider ${providerId} does not support auth completion.`, 'auth_not_supported')
    const connection = await provider.completeAuth(request)
    await this.store.put(connection)
    return connection
  }

  async upsertConnection(connection: IntegrationConnection): Promise<IntegrationConnection> {
    await this.store.put(connection)
    return connection
  }

  async issueCapability(request: IssueCapabilityRequest): Promise<IssuedIntegrationCapability> {
    const connection = await this.requireConnection(request.connectionId)
    this.assertConnectionActive(connection)
    assertScopes(connection, request.scopes)
    const now = this.now()
    const capability: IntegrationCapability = {
      id: `cap_${randomUUID()}`,
      subject: request.subject,
      connectionId: request.connectionId,
      scopes: unique(request.scopes),
      allowedActions: unique(request.allowedActions),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + request.ttlMs).toISOString(),
      metadata: request.metadata,
    }
    return { capability, token: signCapability(capability, this.capabilitySecret) }
  }

  verifyCapability(token: string): IntegrationCapability {
    const capability = verifyCapabilityToken(token, this.capabilitySecret)
    if (Date.parse(capability.expiresAt) <= this.now().getTime()) {
      throw new IntegrationError('Integration capability expired.', 'capability_expired')
    }
    return capability
  }

  async invokeWithCapability(token: string, request: InvokeWithCapabilityRequest): Promise<IntegrationActionResult> {
    const capability = this.verifyCapability(token)
    if (!capability.allowedActions.includes(request.action)) {
      throw new IntegrationError(`Capability does not allow action ${request.action}.`, 'action_denied')
    }
    const connection = await this.requireConnection(capability.connectionId)
    this.assertConnectionActive(connection)
    const provider = this.requireProvider(connection.providerId)
    const connector = await this.requireConnector(provider, connection.connectorId)
    const action = connector.actions.find((candidate) => candidate.id === request.action)
    if (!action) throw new IntegrationError(`Action ${request.action} is not defined by connector ${connector.id}.`, 'action_not_found')
    assertScopes(connection, action.requiredScopes)
    assertScopes({ ...connection, grantedScopes: capability.scopes }, action.requiredScopes)
    const fullRequest: IntegrationActionRequest = { ...request, connectionId: connection.id }
    if (this.policy) {
      const decision = await this.policy.decide({
        connection,
        request: fullRequest,
        action,
        subject: capability.subject,
      })
      if (decision.decision === 'deny') {
        throw new IntegrationError(decision.reason, 'policy_denied')
      }
      if (decision.decision === 'require_approval') {
        return {
          ok: false,
          action: request.action,
          output: { approvalRequired: true, approval: decision.approval },
          metadata: { policyDecision: decision.decision, reason: decision.reason, ...decision.metadata },
        }
      }
    }
    const proceed = () => Promise.resolve(provider.invokeAction(connection, fullRequest))
    if (this.guard) {
      return this.guard.invokeAction({ connection, request: fullRequest, action }, proceed)
    }
    return proceed()
  }

  async subscribeTrigger(connectionId: string, trigger: string, targetUrl?: string): Promise<IntegrationTriggerSubscription> {
    const connection = await this.requireConnection(connectionId)
    this.assertConnectionActive(connection)
    const provider = this.requireProvider(connection.providerId)
    const connector = await this.requireConnector(provider, connection.connectorId)
    const spec = connector.triggers?.find((candidate) => candidate.id === trigger)
    if (!spec) throw new IntegrationError(`Trigger ${trigger} is not defined by connector ${connector.id}.`, 'action_not_found')
    assertScopes(connection, spec.requiredScopes)
    if (!provider.subscribeTrigger) {
      throw new IntegrationError(`Provider ${provider.id} does not support triggers.`, 'auth_not_supported')
    }
    return provider.subscribeTrigger(connection, trigger, targetUrl)
  }

  private requireProvider(providerId: string): IntegrationProvider {
    const provider = this.providers.get(providerId)
    if (!provider) throw new IntegrationError(`Provider ${providerId} not found.`, 'provider_not_found')
    return provider
  }

  private async requireConnector(provider: IntegrationProvider, connectorId: string): Promise<IntegrationConnector> {
    const connector = (await provider.listConnectors()).find((candidate) => candidate.id === connectorId)
    if (!connector) throw new IntegrationError(`Connector ${connectorId} not found.`, 'connector_not_found')
    return connector
  }

  private async requireConnection(connectionId: string): Promise<IntegrationConnection> {
    const connection = await this.store.get(connectionId)
    if (!connection) throw new IntegrationError(`Connection ${connectionId} not found.`, 'connection_not_found')
    return connection
  }

  private assertConnectionActive(connection: IntegrationConnection): void {
    if (connection.status !== 'active') {
      throw new IntegrationError(`Connection ${connection.id} is ${connection.status}.`, 'connection_not_active')
    }
    if (connection.expiresAt && Date.parse(connection.expiresAt) <= this.now().getTime()) {
      throw new IntegrationError(`Connection ${connection.id} is expired.`, 'connection_not_active')
    }
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

export function signCapability(capability: IntegrationCapability, secret: string): string {
  const payload = base64UrlEncode(JSON.stringify(capability))
  const signature = hmac(payload, secret)
  return `${payload}.${signature}`
}

export function verifyCapabilityToken(token: string, secret: string): IntegrationCapability {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) throw new IntegrationError('Malformed integration capability.', 'capability_invalid')
  const expected = hmac(payload, secret)
  if (!constantTimeEqual(signature, expected)) throw new IntegrationError('Invalid integration capability signature.', 'capability_invalid')
  let parsed: IntegrationCapability
  try {
    parsed = JSON.parse(base64UrlDecode(payload)) as IntegrationCapability
  } catch {
    throw new IntegrationError('Invalid integration capability payload.', 'capability_invalid')
  }
  if (!parsed.id || !parsed.connectionId || !Array.isArray(parsed.scopes) || !Array.isArray(parsed.allowedActions)) {
    throw new IntegrationError('Invalid integration capability payload.', 'capability_invalid')
  }
  return parsed
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

function assertScopes(connection: Pick<IntegrationConnection, 'grantedScopes'>, requiredScopes: string[]): void {
  const missing = requiredScopes.filter((scope) => !connection.grantedScopes.includes(scope))
  if (missing.length > 0) throw new IntegrationError(`Missing integration scopes: ${missing.join(', ')}`, 'scope_denied')
}

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

// ─── Connectors namespace ───────────────────────────────────────────────
//
// Lower-level adapter primitives — the contract a concrete first-party
// integration (Google Calendar, HubSpot, Stripe, ...) implements. The
// hub-side `IntegrationProvider` interface is the *catalog* facade above
// these; one provider can wrap many connectors. See `src/connectors/types.ts`
// for the layering details.
export * from './connectors/index.js'
export * from './catalog.js'
export * from './policy.js'
export * from './sandbox.js'
export * from './adapter-provider.js'
export * from './importers.js'
export * from './coverage-catalog.js'
