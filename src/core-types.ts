/**
 * Vendor-neutral integration contracts.
 *
 * Pure type module: every interface, type alias, and enum that other
 * source files reference lives here. Holds zero runtime symbols so any
 * module can import from it without forming a cycle through the package
 * barrel (`./index.ts`).
 *
 * Runtime classes (`IntegrationError`, `InMemoryConnectionStore`,
 * `IntegrationHub`, helpers) stay in `./index.ts` or are split out into
 * their own focused modules (`./core-error.ts`).
 */

import type { ConnectorCredentials } from './connectors/types.js'

export type IntegrationProviderKind =
  | 'first_party'
  | 'nango'
  | 'pipedream'
  | 'zapier'
  | 'activepieces'
  | 'tangle_catalog'
  | 'executor'
  | 'custom'
  | 'mcp'

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
  type: 'user' | 'team' | 'app' | 'agent' | 'sandbox' | 'system'
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
 * guarantees that span every provider, gateway, and webhook receiver. The
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
  /** Host-injectable secret store. Multi-tenant hubs inject a durable
   *  encrypted store; defaults to InMemoryIntegrationSecretStore for
   *  local/dev and tests. The interface is the contract — the lib never
   *  ships a D1/KV/encryption impl. */
  secretStore?: IntegrationSecretStore
  /** Host-injectable single-use OAuth-state store guarding the start →
   *  callback CSRF boundary. Defaults to InMemoryIntegrationOAuthStateStore. */
  oauthStateStore?: IntegrationOAuthStateStore
  /** TTL applied to OAuth-state records the hub stashes at startAuth.
   *  Defaults to 10 minutes. */
  oauthStateTtlMs?: number
  /** Fired whenever a provider surfaces rotated credentials during an
   *  invoke (e.g. an OAuth access token refreshed on expiry). The host
   *  re-encrypts + persists the rotated envelope so the next expiry does
   *  not force a reconnect. The hub also writes the rotated credentials to
   *  {@link secretStore} when the connection carries a secretRef. */
  credentialsRotated?: (event: IntegrationCredentialsRotatedEvent) => Promise<void> | void
  now?: () => Date
}

/** Emitted when a provider rotates credentials mid-invoke. The host
 *  re-persists `credentials` against `secretRef` (when present) so the
 *  refreshed token survives the call. */
export interface IntegrationCredentialsRotatedEvent {
  connection: IntegrationConnection
  secretRef?: SecretRef
  credentials: ConnectorCredentials
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

/** A catalog of connectors keyed by stable source id. The registry merges
 *  multiple sources (first-party adapter packs, Activepieces import, custom
 *  HTTP catalog, …) into a canonical view with conflict reporting. */
export interface IntegrationCatalogSource {
  id: string
  connectors: IntegrationConnector[]
  precedence?: number
}

/** Host-injectable persistent store for OAuth tokens and other connector
 *  credentials. Multi-tenant hubs inject a durable encrypted store; defaults
 *  to an in-memory implementation for local/dev and tests. The interface is
 *  the contract — the lib never ships a D1/KV/encryption impl. */
export interface IntegrationSecretStore {
  get(ref: SecretRef): Promise<ConnectorCredentials | undefined> | ConnectorCredentials | undefined
  put(ref: SecretRef, credentials: ConnectorCredentials): Promise<void> | void
  delete?(ref: SecretRef): Promise<void> | void
}

/** Single-use record stashed at OAuth-start and consumed once at callback to
 *  guard against CSRF / replay. The hub injects its own durable
 *  implementation (KV/Redis/D1) so the callback can land on any worker. */
export interface IntegrationOAuthState {
  /** Opaque value round-tripped through the provider redirect. */
  state: string
  /** Provider the auth flow targets. */
  providerId: string
  /** Connector the user is connecting. */
  connectorId: string
  /** Owner initiating the flow. */
  owner: IntegrationActor
  /** Scopes requested at start; verified against the granted scopes on callback. */
  requestedScopes: string[]
  /** Redirect URI used at start; MUST match exactly on callback exchange. */
  redirectUri: string
  /** PKCE code_verifier, when the connector uses PKCE. */
  codeVerifier?: string
  /** Absolute expiry (UTC ms since epoch). consume() MUST treat an expired
   *  record as a miss. */
  expiresAt: number
  /** Arbitrary non-secret context the host pinned at start-time. */
  metadata?: Record<string, unknown>
}

/** Outcome of consuming an OAuth state record. Callers MUST inspect `ok`
 *  before using `state`; a miss (`unknown`/`expired`) is the CSRF/replay
 *  guard firing, not an exception. */
export type IntegrationOAuthStateOutcome =
  | { ok: true; state: IntegrationOAuthState }
  | { ok: false; reason: 'unknown' | 'expired' }

/** Host-injectable store for single-use OAuth-start records. The default is
 *  in-memory for local/dev and tests; multi-tenant hubs inject a durable
 *  encrypted store so callbacks survive worker hops. consume() MUST be
 *  single-use: a second consume of the same state returns `{ ok: false }`. */
export interface IntegrationOAuthStateStore {
  put(state: IntegrationOAuthState): Promise<void> | void
  consume(state: string): Promise<IntegrationOAuthStateOutcome> | IntegrationOAuthStateOutcome
  sweep?(now: number): Promise<void> | void
}
