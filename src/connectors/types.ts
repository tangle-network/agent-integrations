/**
 * Connector primitives — the contract a concrete first-party integration
 * (Google Calendar, HubSpot, Stripe, ...) implements. Lower level than the
 * hub-side `IntegrationProvider` interface from `../index.ts`: a single
 * `IntegrationProvider` typically wraps several connectors (e.g., a
 * "first-party" provider that lists all your shipped connectors as a
 * single catalog).
 *
 * Layering:
 *
 *   IntegrationHub                                — vendor-neutral facade (../index.ts)
 *     ↓
 *   IntegrationProvider                           — one per gateway or first-party provider
 *     ↓
 *   ConnectorAdapter (this file)                  — one per integration (Google Calendar, ...)
 *     ↓
 *   upstream HTTP API                             — vendor SDK / fetch / OAuth
 *
 * Three load-bearing decisions encoded here:
 *
 * 1. Capabilities are typed (`read` vs `mutation`). Every mutation MUST
 *    declare a CAS strategy. Conflict resolution is the SDK's job, not the
 *    connector's. `validateConnectorManifest()` rejects unsafe manifests
 *    before a connector is registered.
 *
 * 2. ConsistencyModel pins what the rest of the system can assume:
 *      authoritative → the source IS the truth (Calendar, payments)
 *      cache         → we mirror with TTL and may serve stale (price list)
 *      advisory      → informational only (FAQ doc)
 *    Agent planners can (and should) refuse to promise outcomes based on
 *    `cache`/`advisory` data without a live `authoritative` confirmation.
 *
 * 3. Capabilities surface to the calling agent's tool registry by
 *    transformation, not by hand-wiring. Adding a connector automatically
 *    expands the agent's toolbelt for that specific user without touching
 *    the prompt or runner.
 */

/** Minimal JSON-schema shape used for capability arg validation. We
 *  intentionally don't pull `@types/json-schema` — most consumers already
 *  declare parameters as `Record<string, unknown>` and the
 *  shape is whatever the LLM SDK's structured-output expects. Keep the
 *  contract loose at the boundary; tighten via runtime zod where needed. */
export type CapabilityParameterSchema = Record<string, unknown>

/** What the rest of the system is allowed to assume about freshness. */
export type ConsistencyModel = 'authoritative' | 'cache' | 'advisory'

/** Capability classes. `read` is safe to retry; `mutation` must go through
 *  MutationGuard (CAS + idempotency). `subscribe` is reserved for future
 *  push-driven sources (webhook callbacks) and is not yet wired. */
export type CapabilityClass = 'read' | 'mutation' | 'subscribe'

/** Compare-and-swap strategy a mutation uses to detect conflicts. */
export type CASStrategy =
  /** Upstream returns an etag/sequence on read, accepts If-Match on write
   *  (Google Calendar, GitHub, GDocs revision_id). The connector returns
   *  412 / Precondition Failed on conflict; the SDK maps to ResourceContention. */
  | 'etag-if-match'
  /** Upstream guarantees exactly-once-per-key (Stripe, idempotent webhooks).
   *  The SDK passes the idempotency key through; no etag check. */
  | 'native-idempotency'
  /** No upstream concurrency control. Connector MUST do read-then-write
   *  and verify nothing changed in-between (best-effort). Suitable only
   *  for low-contention single-user resources; rejected for any
   *  consistencyModel='authoritative' write that may race. */
  | 'optimistic-read-verify'
  /** Source is not contended (e.g. logging, telemetry). Mutations are
   *  fire-and-forget. Marks the capability as not eligible for
   *  authoritative writes. */
  | 'none'

export interface CapabilityRead {
  name: string
  class: 'read'
  description: string
  /** JSON-schema for the tool args the agent passes when invoking. */
  parameters: CapabilityParameterSchema
  /** Optional: declare which scopes (per the connector manifest) this
   *  capability requires. The capability is hidden from the agent's
   *  tool registry if the user's grant didn't include them. */
  requiredScopes?: string[]
}

export interface CapabilityMutation {
  name: string
  class: 'mutation'
  description: string
  parameters: CapabilityParameterSchema
  /** Mandatory: how does the connector guarantee at-most-once + conflict-detect? */
  cas: CASStrategy
  /** True for capabilities that affect resources outside the calling user
   *  (e.g. booking against a shared calendar, charging a card). The agent's
   *  planner treats these specially: requires explicit caller confirmation
   *  before the call. */
  externalEffect: boolean
  requiredScopes?: string[]
}

export type Capability = CapabilityRead | CapabilityMutation

/** OAuth2 scope catalog the user has granted us, plus arbitrary metadata
 *  the connector pinned at connect-time (calendar id, sheet id, webhook
 *  url, …). `metadata` MUST NOT contain secrets — those go in the
 *  encrypted credentials envelope. */
export interface DataSourceMetadata {
  scopes: string[]
  [key: string]: unknown
}

/** A connected, authenticated, ready-to-call data source for a project.
 *  Persistence shape mirrors the product's connection/source row but normalized — the
 *  encrypted credentials envelope is decrypted at hand-out time and held
 *  in memory only for the duration of the call. */
export interface ResolvedDataSource {
  id: string
  projectId: string
  publishedAgentId: string | null
  kind: string
  label: string
  consistencyModel: ConsistencyModel
  scopes: string[]
  metadata: Record<string, unknown>
  /** Unwrapped credentials handed to the connector at call-time. Never
   *  persisted in this shape; never logged. */
  credentials: ConnectorCredentials
  status: 'active' | 'revoked' | 'error'
}

/** Discriminated union of credential shapes. Connectors that need new
 *  shapes extend this union — `kind` is sealed via the tagged pattern so
 *  TypeScript catches an exhaustiveness gap at compile time. */
export type ConnectorCredentials =
  | { kind: 'oauth2'; accessToken: string; refreshToken?: string; expiresAt?: number }
  | { kind: 'api-key'; apiKey: string }
  | { kind: 'custom'; values: Record<string, unknown> }
  | { kind: 'hmac'; secret: string }
  | { kind: 'none' }

/** Result of a read capability invocation. */
export interface CapabilityReadResult {
  /** Free-form payload — the connector's data shape. The agent receives
   *  this as the tool result; planners consume it via JSON-shape contract
   *  declared in the capability's `parameters` (output schema). */
  data: unknown
  /** Optional etag/sequence the caller can reuse for a subsequent CAS
   *  mutation. */
  etag?: string
  /** When this read happened (UTC ms since epoch). */
  fetchedAt: number
}

/** Result of a mutation capability invocation. Either committed (with the
 *  resulting etag/sequence so the caller can chain mutations), or
 *  contended (the upstream rejected with a state mismatch — the agent
 *  should re-read and retry, or surface alternatives to the caller). */
export type CapabilityMutationResult =
  | {
      status: 'committed'
      data: unknown
      etagAfter?: string
      committedAt: number
      /** True iff this commit was returned from the idempotency store
       *  rather than executed against upstream. The caller can use this
       *  to suppress confirmation messages on retry. */
      idempotentReplay: boolean
    }
  | {
      status: 'conflict'
      /** Best-effort alternative options the upstream surfaced (e.g.,
       *  next-available calendar slots after a booking conflict). */
      alternatives: unknown[]
      /** The current authoritative state, if the connector could re-read
       *  cheaply. */
      currentState?: unknown
      message: string
    }
  | {
      status: 'rate-limited'
      /** Wall-clock ms the caller should wait before retrying. The SDK
       *  computes this from the bucket's refill schedule so the agent
       *  doesn't have to guess. */
      retryAfterMs: number
      message: string
    }

/** Inputs the SDK passes into the connector's executeRead / executeMutation. */
export interface ConnectorInvocation {
  source: ResolvedDataSource
  capabilityName: string
  args: Record<string, unknown>
  /** Idempotency key the caller (or the SDK's defaulting policy) supplied.
   *  Always present at the connector boundary — the SDK manufactures one
   *  if the agent didn't pass one. */
  idempotencyKey: string
  /** Optional caller-supplied etag the connector should send as If-Match. */
  expectedEtag?: string
  /** Product/session id (if any) for forensic logging. */
  callSessionId?: string
}

/** A single inbound event extracted from a push payload. The webhook
 *  receiver persists one `InboundEvent` row per entry the connector returns. */
export interface InboundEvent {
  eventType: string
  providerEventId?: string
  payload: Record<string, unknown>
}

/** Adapter response from an inbound-webhook dispatch. The receiver persists
 *  every `events[]` entry, then either honors the connector's `response`
 *  override (Slack `url_verification` echo, provider-specific 2xx body) or
 *  defaults to `{status: 200, body: {received: true, count: events.length}}`. */
export interface EventHandlerResult {
  events: InboundEvent[]
  /** Optional: how to respond to the provider. Stripe wants 200 within
   *  30s; Slack wants the challenge param echoed. */
  response?: { status: number; body: unknown; headers?: Record<string, string> }
}

/**
 * Connector adapter — one per integration kind. Stateless. The SDK holds
 * the persistence + crypto + mutation-guard concerns; the adapter only
 * knows how to talk to its upstream.
 */
export interface ConnectorAdapter {
  /** Manifest entry the registry uses to render UI + validate args. */
  manifest: ConnectorManifest
  /** Read invocation. Required when manifest.capabilities contains reads.
   *  Should return whatever shape the capability declared
   *  in its parameters output schema. */
  executeRead?(inv: ConnectorInvocation): Promise<CapabilityReadResult>
  /** Mutation invocation. Required when manifest.capabilities contains mutations.
   *  Throws ResourceContention on a CAS miss; throws
   *  any other Error for upstream failures. The MutationGuard wraps this
   *  with idempotency-key short-circuit + audit logging — adapters do
   *  NOT manage their own dedup. */
  executeMutation?(inv: ConnectorInvocation): Promise<CapabilityMutationResult>
  /** Inbound webhook signature verifier. Called BEFORE handleInboundEvent.
   *  MUST use constant-time comparison (`crypto.timingSafeEqual`) for any
   *  HMAC check. The receiver returns 401 on `valid=false` without invoking
   *  handleInboundEvent. Optional: connectors that don't accept push events
   *  omit this method and the receiver returns 405 for the kind. */
  verifySignature?(input: {
    rawBody: string
    headers: Record<string, string | string[] | undefined>
    source: ResolvedDataSource
  }): { valid: boolean; reason?: string }
  /** Inbound webhook dispatch. Called AFTER verifySignature passes. The
   *  adapter parses the provider payload and emits zero-or-more
   *  `InboundEvent` rows; the receiver persists them as one row each (modulo
   *  the (dataSourceId, providerEventId) dedup unique). The optional
   *  `response` overrides the receiver's default 200 (Slack `url_verification`
   *  needs to echo the challenge in the body to pass Slack's app-config check). */
  handleInboundEvent?(input: {
    source: ResolvedDataSource
    rawBody: string
    headers: Record<string, string | string[] | undefined>
  }): Promise<EventHandlerResult>
  /** OAuth callback handler — exchanges the auth code for tokens, returns
   *  the credentials envelope + scopes + metadata. Only present for
   *  oauth2-style adapters. */
  exchangeOAuth?(input: {
    code: string
    state: string
    codeVerifier: string
    redirectUri: string
  }): Promise<{
    credentials: ConnectorCredentials
    scopes: string[]
    metadata: Record<string, unknown>
  }>
  /** Refresh access token. Only required for oauth2 adapters with
   *  short-lived access tokens. */
  refreshToken?(input: ConnectorCredentials): Promise<ConnectorCredentials>
  /** Health check — invoked when the user clicks "Test connection" in the
   *  UI. Should perform the cheapest possible read that proves the grant
   *  is still valid. Returns `{ok: false, reason}` rather than throwing
   *  for the common case (token expired, scope missing). */
  test(source: ResolvedDataSource): Promise<{ ok: true } | { ok: false; reason: string }>
}

/** Static manifest a connector module exports. Drives the UI catalog,
 *  scope display, capability discovery for the agent's tool registry. */
export interface ConnectorManifest {
  /** Stable kind id used as the foreign key in DataSource.kind. */
  kind: string
  /** Human label shown in the UI catalog. */
  displayName: string
  /** One-paragraph description shown next to the connect button. */
  description: string
  /** Auth shape this connector requires. */
  auth: AuthSpec
  /** Capability catalog — the agent's tool registry derives ToolDefinition
   *  entries from this list at request time. */
  capabilities: Capability[]
  /** ConsistencyModel default for this kind — overridable per DataSource
   *  if a particular instance is special (e.g., a user marks a sheet as
   *  `cache` because they refresh it nightly). */
  defaultConsistencyModel: ConsistencyModel
  /** Connector category for UI grouping. */
  category: 'calendar' | 'spreadsheet' | 'crm' | 'doc' | 'webhook' | 'storage' | 'comms' | 'commerce' | 'other'
  /** Optional icon URL or named icon. */
  icon?: string
  /** Optional per-kind rate-limit budget. The SDK enforces it inside
   *  `executeGuardedMutation` and the read path of `/invoke`. Omit to
   *  leave the connector unrestricted. */
  rateLimit?: RateLimitSpec
}

/** Token-bucket budget the SDK enforces against the connector's upstream.
 *  We meter on OUR side rather than letting the upstream reject so a
 *  chatty agent can't burn quota that's shared across customers (almost
 *  every OAuth client is). */
export interface RateLimitSpec {
  /** Max requests per window. */
  requests: number
  /** Window in ms. */
  windowMs: number
  /** Whether to apply across all DataSources sharing the same OAuth
   *  client (true; default), or per-DataSource (false). The former
   *  matches how upstreams meter (per-app), so almost always pick true. */
  scope?: 'oauth-client' | 'data-source'
}

export type AuthSpec =
  | {
      kind: 'oauth2'
      /** Authorization endpoint URL. */
      authorizationUrl: string
      /** Token endpoint URL. */
      tokenUrl: string
      /** Scopes requested in the authorization grant. The user UI shows
       *  these so the customer knows what's being shared. */
      scopes: string[]
      /** Whether the connector supports incremental authorization (Google
       *  does; many don't). */
      incremental?: boolean
      /** Env-var name holding the OAuth client_id. */
      clientIdEnv: string
      /** Env-var name holding the OAuth client_secret. */
      clientSecretEnv: string
      /** Optional extra params attached to the authorization URL (e.g.,
       *  Google's `access_type=offline&prompt=consent` to obtain refresh
       *  tokens). */
      extraAuthParams?: Record<string, string>
    }
  | {
      kind: 'api-key'
      /** UI hint shown when collecting the key. */
      hint: string
    }
  | { kind: 'hmac' }
  | { kind: 'none' }

/** Thrown by `executeMutation` when upstream rejects on CAS — caught and
 *  rewrapped by MutationGuard. */
export class ResourceContention extends Error {
  override readonly name = 'ResourceContention'
  constructor(
    message: string,
    public readonly alternatives: unknown[] = [],
    public readonly currentState?: unknown,
  ) {
    super(message)
  }
}

/** Thrown when the connector finds the user's grant has been revoked or
 *  the access token is no longer valid AND refresh failed. Surfaces to
 *  the UI as "Reconnect required". */
export class CredentialsExpired extends Error {
  override readonly name = 'CredentialsExpired'
  constructor(message: string, public readonly dataSourceId: string) {
    super(message)
  }
}

export interface ConnectorManifestValidationIssue {
  path: string
  message: string
}

export interface ConnectorManifestValidationResult {
  ok: boolean
  issues: ConnectorManifestValidationIssue[]
}

/** Validate the static connector manifest before a provider registers it.
 *  This catches the expensive mistakes early: duplicate capability names,
 *  mutation capabilities without CAS, authoritative fire-and-forget writes,
 *  and invalid rate-limit specs. */
export function validateConnectorManifest(manifest: ConnectorManifest): ConnectorManifestValidationResult {
  const issues: ConnectorManifestValidationIssue[] = []
  if (!manifest.kind.trim()) issues.push({ path: 'kind', message: 'kind is required' })
  if (!manifest.displayName.trim()) issues.push({ path: 'displayName', message: 'displayName is required' })
  const seen = new Set<string>()
  for (const [index, capability] of manifest.capabilities.entries()) {
    const path = `capabilities[${index}]`
    if (!capability.name.trim()) issues.push({ path: `${path}.name`, message: 'capability name is required' })
    if (seen.has(capability.name)) issues.push({ path: `${path}.name`, message: `duplicate capability name: ${capability.name}` })
    seen.add(capability.name)
    if (capability.class === 'mutation') {
      if (!capability.cas) issues.push({ path: `${path}.cas`, message: 'mutation capability must declare a CAS strategy' })
      if (manifest.defaultConsistencyModel === 'authoritative' && capability.cas === 'none') {
        issues.push({ path: `${path}.cas`, message: 'authoritative mutations cannot use cas="none"' })
      }
    }
  }
  if (manifest.rateLimit) {
    if (!Number.isFinite(manifest.rateLimit.requests) || manifest.rateLimit.requests <= 0) {
      issues.push({ path: 'rateLimit.requests', message: 'rateLimit.requests must be positive' })
    }
    if (!Number.isFinite(manifest.rateLimit.windowMs) || manifest.rateLimit.windowMs <= 0) {
      issues.push({ path: 'rateLimit.windowMs', message: 'rateLimit.windowMs must be positive' })
    }
  }
  return { ok: issues.length === 0, issues }
}

export function assertValidConnectorManifest(manifest: ConnectorManifest): void {
  const result = validateConnectorManifest(manifest)
  if (!result.ok) {
    throw new Error(`Invalid connector manifest ${manifest.kind || '<unknown>'}: ${result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`)
  }
}
