/**
 * @stable Integration Hub consumer client.
 *
 * The third client-shaped surface a product needs, alongside the two that
 * already ship:
 *
 *   - `createTangleIntegrationsClient` (`client.ts`) — the *invoke* client.
 *     Capability-token auth, runs INSIDE a sandbox / generated app, single
 *     endpoint `/v1/integrations/invoke`.
 *   - `startConnectFlow` / `finishConnectFlow` (`connect/index.ts`) — the
 *     *user-consent* flow, mirrors `/cross-site/*`.
 *   - **this** — the S2S *management* client. A product BACKEND (blueprint-
 *     agent, sandbox, gtm-agent, tax-agent, legal-agent, evals, …) drives the
 *     `/v1/integrations/{resolve-manifest,grants,capabilities/bundle,
 *     healthchecks/run}` management surface on `id.tangle.tools` on behalf of
 *     an identified user.
 *
 * Every consumer needs the identical client — the wire protocol, the
 * `{ success, data }` envelope, the auth header shape are all platform-owned.
 * Re-implementing a bespoke fetch loop per product forks the protocol and the
 * copies drift. This module is that shared implementation. It mirrors the
 * `connect/index.ts` design rule one-for-one: DO NOT invent the wire protocol
 * — speak exactly what `products/platform/api/src/routes/integrations.ts`
 * serves.
 *
 * Two auth modes — the route layer (`authMiddleware`) accepts either:
 *
 *   - `service`  — a `svc_*` service token + `X-Service-Name`. The acting
 *     user travels in `X-Platform-User-Id`. The platform honors that header
 *     only for service tokens whose `SERVICE_SCOPES` set contains
 *     `impersonate:user`; a token without it is rejected (403). Reaches the
 *     four management paths the platform allowlists for service tokens.
 *   - `user-key` — a per-user `sk-tan-*` API key (minted via the connect
 *     flow). The key identifies the user; no impersonation header. Reaches
 *     every route the user themselves can.
 *
 * The capability-token `invoke` endpoint is intentionally NOT exposed here —
 * that is `createTangleIntegrationsClient`'s job and uses a different auth.
 */

import type { IntegrationActor, IntegrationConnection } from './index.js'
import type {
  IntegrationGrant,
  IntegrationManifest,
  IntegrationManifestResolution,
  IntegrationRequirementMode,
  IntegrationRequirementResolution,
  IntegrationSandboxBundle,
} from './runtime.js'
import type { IntegrationHealthcheckResult } from './healthcheck.js'
import { DEFAULT_TANGLE_PLATFORM_URL } from './connectors/adapters/tangle-id.js'

/** Matches the platform's `PLATFORM_USER_ID_PATTERN` (`auth.ts`). A user id
 *  that fails this is rejected client-side before the request leaves. */
const PLATFORM_USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_ATTEMPTS = 2
/** HTTP statuses worth a retry — transient platform/edge failures only.
 *  4xx is deterministic and never retried. */
const RETRYABLE_STATUSES = new Set([502, 503, 504])

export type IntegrationHubAuth =
  | {
      mode: 'service'
      /** The `svc_*` token issued to this product. */
      serviceToken: string
      /** Registered service name — sent as `X-Service-Name`. Required
       *  because one token may be shared across services, in which case the
       *  platform demands the header to disambiguate. */
      serviceName: string
    }
  | {
      mode: 'user-key'
      /** A per-user `sk-tan-*` key bound to the acting user. */
      apiKey: string
    }

export interface IntegrationHubClientOptions {
  /** The product / consumer identifier (e.g. `blueprint-agent`). Sent as the
   *  `product` field of resolve-manifest calls; recorded platform-side. */
  product: string
  /** Service-token or per-user-key auth. */
  auth: IntegrationHubAuth
  /** Platform base URL. Defaults to `https://id.tangle.tools`. */
  endpoint?: string
  /** Injected for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Per-request timeout in ms. Default 10_000. */
  timeoutMs?: number
  /** Max attempts on transient (network / 502 / 503 / 504) failures.
   *  Default 2 — i.e. one retry. */
  maxAttempts?: number
}

/** Thrown for every non-2xx response and every transport failure. Carries the
 *  HTTP status and the platform error code so callers can branch precisely
 *  (`403` + `impersonate` → the service token lacks the scope; `409` /
 *  `missing_connection` → prompt the user to connect). */
export class IntegrationHubRequestError extends Error {
  readonly name = 'IntegrationHubRequestError'
  /** HTTP status, or 0 for a network-level failure. */
  readonly status: number
  /** Platform error code (`VALIDATION_ERROR`, `scope_missing`, …) or
   *  `network_error` / `http_error` when no structured code was returned. */
  readonly code: string
  /** `METHOD /path` the request targeted. */
  readonly endpoint: string
  /** True when the failure class is transient and a retry could succeed. */
  readonly retryable: boolean

  constructor(input: {
    status: number
    code: string
    message: string
    endpoint: string
    retryable: boolean
  }) {
    super(input.message)
    this.status = input.status
    this.code = input.code
    this.endpoint = input.endpoint
    this.retryable = input.retryable
  }
}

export interface ResolveManifestInput {
  /** The acting user — the connection owner. */
  userId: string
  manifest: IntegrationManifest
  /** Overrides the client-level `product` for this call. */
  product?: string
}

export interface CreateGrantsInput {
  /** The acting user — the connection owner. */
  userId: string
  /** Who the grant is FOR (the sandbox / agent / app that will invoke). */
  grantee: IntegrationActor
  manifest: IntegrationManifest
  metadata?: Record<string, unknown>
}

export interface ListGrantsInput {
  /** The acting user — the connection owner. */
  userId: string
  /** Optional grantee filter; both fields travel together as query params. */
  grantee?: IntegrationActor
}

export interface MintCapabilityBundleInput {
  /** The acting user — must own every connection behind the grants. */
  userId: string
  /** Who the capability bundle is issued TO (the sandbox / agent process). */
  subject: IntegrationActor
  /** Mint from every grant of a manifest … */
  manifestId?: string
  /** … or from an explicit grant id list. Exactly one of the two is required. */
  grantIds?: string[]
  grantee?: IntegrationActor
  /** Bundle TTL in ms. Platform clamps to [1s, 60m]; default 15m. */
  ttlMs?: number
}

export interface CapabilityBundleResult {
  bundle: IntegrationSandboxBundle
  /** Bridge environment variables to inject into the sandbox process —
   *  `buildIntegrationBridgeEnvironment(bundle)`, computed platform-side. */
  env: Record<string, string>
}

export interface CheckConnectorInput {
  /** The acting user. */
  userId: string
  /** Connector to probe — `github`, `google-calendar`, `tangle-id`, … */
  connectorId: string
  /** Defaults to `read`. */
  mode?: IntegrationRequirementMode
  requiredScopes?: string[]
  requiredActions?: string[]
}

export interface CheckConnectorResult {
  /** True when the user has an active connection satisfying the requirement. */
  connected: boolean
  /** The satisfying connection, present iff `connected`. */
  connection?: IntegrationConnection
  /** The full requirement resolution — status, missing scopes/actions, message. */
  resolution: IntegrationRequirementResolution
}

/**
 * S2S management client for the `id.tangle.tools` integration hub. One per
 * product; methods are stateless and safe to call concurrently.
 */
export class IntegrationHubClient {
  private readonly endpoint: string
  private readonly product: string
  private readonly auth: IntegrationHubAuth
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxAttempts: number

  constructor(options: IntegrationHubClientOptions) {
    if (!options.product) {
      throw new Error('IntegrationHubClient: product is required')
    }
    if (options.auth.mode === 'service' && !options.auth.serviceToken) {
      throw new Error('IntegrationHubClient: service auth requires a serviceToken')
    }
    if (options.auth.mode === 'service' && !options.auth.serviceName) {
      throw new Error('IntegrationHubClient: service auth requires a serviceName')
    }
    if (options.auth.mode === 'user-key' && !options.auth.apiKey) {
      throw new Error('IntegrationHubClient: user-key auth requires an apiKey')
    }
    this.endpoint = (options.endpoint ?? DEFAULT_TANGLE_PLATFORM_URL).replace(/\/+$/, '')
    this.product = options.product
    this.auth = options.auth
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  }

  /**
   * Resolve a manifest against a user's connections. The returned
   * `ready` / `missing` split is the canonical way to ask "does this user
   * have the connections this work needs" — the raw connection list is not
   * reachable by a service token by design.
   */
  async resolveManifest(input: ResolveManifestInput): Promise<IntegrationManifestResolution> {
    return this.request<IntegrationManifestResolution>('POST', '/resolve-manifest', input.userId, {
      product: input.product ?? this.product,
      manifest: input.manifest,
      ownerUserId: input.userId,
    })
  }

  /**
   * Convenience over {@link resolveManifest} — probe a single connector and
   * get back a boolean plus the satisfying connection. The Surface-A quest
   * primitive ("is the user's GitHub linked?").
   */
  async checkConnector(input: CheckConnectorInput): Promise<CheckConnectorResult> {
    const requirementId = input.connectorId
    const resolution = await this.resolveManifest({
      userId: input.userId,
      manifest: {
        id: `connectivity-check:${input.connectorId}`,
        requirements: [
          {
            id: requirementId,
            connectorId: input.connectorId,
            reason: `Connectivity check for ${input.connectorId}`,
            mode: input.mode ?? 'read',
            ...(input.requiredScopes ? { requiredScopes: input.requiredScopes } : {}),
            ...(input.requiredActions ? { requiredActions: input.requiredActions } : {}),
          },
        ],
      },
    })
    const requirement =
      resolution.ready.find((r) => r.requirement.id === requirementId) ??
      resolution.missing.find((r) => r.requirement.id === requirementId) ??
      resolution.optionalMissing.find((r) => r.requirement.id === requirementId)
    if (!requirement) {
      throw new IntegrationHubRequestError({
        status: 0,
        code: 'malformed_response',
        message: `resolve-manifest returned no resolution for requirement ${requirementId}`,
        endpoint: 'POST /resolve-manifest',
        retryable: false,
      })
    }
    return {
      connected: requirement.status === 'ready',
      ...(requirement.connection ? { connection: requirement.connection } : {}),
      resolution: requirement,
    }
  }

  /** Create grants for every satisfiable requirement of a manifest. The
   *  platform rejects the call if any non-optional requirement is missing a
   *  connection. */
  async createGrants(input: CreateGrantsInput): Promise<IntegrationGrant[]> {
    const data = await this.request<{ grants: IntegrationGrant[] }>(
      'POST',
      '/grants',
      input.userId,
      {
        grantee: input.grantee,
        manifest: input.manifest,
        ownerUserId: input.userId,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    )
    return data.grants
  }

  /** List the acting user's grants, optionally filtered to one grantee. */
  async listGrants(input: ListGrantsInput): Promise<IntegrationGrant[]> {
    const query =
      input.grantee !== undefined
        ? `?granteeType=${encodeURIComponent(input.grantee.type)}&granteeId=${encodeURIComponent(input.grantee.id)}`
        : ''
    const data = await this.request<{ grants: IntegrationGrant[] }>(
      'GET',
      `/grants${query}`,
      input.userId,
    )
    return data.grants
  }

  /** Mint a short-lived capability bundle for a sandbox / agent process.
   *  Provider credentials never leave the platform — the bundle carries only
   *  scoped, expiring capability tokens. */
  async mintCapabilityBundle(input: MintCapabilityBundleInput): Promise<CapabilityBundleResult> {
    if (!input.manifestId && !(input.grantIds && input.grantIds.length > 0)) {
      throw new Error(
        'IntegrationHubClient.mintCapabilityBundle: manifestId or a non-empty grantIds is required',
      )
    }
    return this.request<CapabilityBundleResult>('POST', '/capabilities/bundle', input.userId, {
      subject: input.subject,
      ...(input.manifestId ? { manifestId: input.manifestId } : {}),
      ...(input.grantIds ? { grantIds: input.grantIds } : {}),
      ...(input.grantee ? { grantee: input.grantee } : {}),
      ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
    })
  }

  /** Run live healthchecks across all of the acting user's connections. */
  async runHealthchecks(input: { userId: string }): Promise<IntegrationHealthcheckResult[]> {
    const data = await this.request<{ healthchecks: IntegrationHealthcheckResult[] }>(
      'POST',
      '/healthchecks/run',
      input.userId,
      { ownerUserId: input.userId },
    )
    return data.healthchecks
  }

  private buildHeaders(userId: string, hasBody: boolean): Headers {
    const headers = new Headers({ accept: 'application/json' })
    if (hasBody) headers.set('content-type', 'application/json')
    if (this.auth.mode === 'service') {
      headers.set('authorization', `Bearer ${this.auth.serviceToken}`)
      headers.set('x-service-name', this.auth.serviceName)
      headers.set('x-platform-user-id', userId)
    } else {
      headers.set('authorization', `Bearer ${this.auth.apiKey}`)
    }
    return headers
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    userId: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!PLATFORM_USER_ID_PATTERN.test(userId)) {
      throw new IntegrationHubRequestError({
        status: 0,
        code: 'invalid_user_id',
        message: `userId ${JSON.stringify(userId)} is not a valid platform user id`,
        endpoint: `${method} ${path}`,
        retryable: false,
      })
    }
    const url = `${this.endpoint}/v1/integrations${path}`
    const endpointLabel = `${method} /v1/integrations${path}`
    const headers = this.buildHeaders(userId, body !== undefined)
    const init: RequestInit = {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }

    let lastError: IntegrationHubRequestError | undefined
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      } catch (error) {
        lastError = new IntegrationHubRequestError({
          status: 0,
          code: 'network_error',
          message: `${endpointLabel} failed: ${error instanceof Error ? error.message : String(error)}`,
          endpoint: endpointLabel,
          retryable: true,
        })
        if (attempt < this.maxAttempts) {
          await delay(attempt)
          continue
        }
        throw lastError
      }

      const payload = await readJson(response)
      if (response.ok && isSuccessEnvelope(payload)) {
        return payload.data as T
      }

      const retryable = RETRYABLE_STATUSES.has(response.status)
      lastError = new IntegrationHubRequestError({
        status: response.status,
        code: errorCode(payload, response.status),
        message: errorMessage(payload, endpointLabel, response.status),
        endpoint: endpointLabel,
        retryable,
      })
      if (retryable && attempt < this.maxAttempts) {
        await delay(attempt)
        continue
      }
      throw lastError
    }
    // Unreachable — the loop always returns or throws — but satisfies the
    // type checker and fails loud if the invariant is ever broken.
    throw (
      lastError ??
      new IntegrationHubRequestError({
        status: 0,
        code: 'unknown',
        message: `${endpointLabel} exhausted retries without a result`,
        endpoint: endpointLabel,
        retryable: false,
      })
    )
  }
}

export function createIntegrationHubClient(
  options: IntegrationHubClientOptions,
): IntegrationHubClient {
  return new IntegrationHubClient(options)
}

interface SuccessEnvelope {
  success: true
  data: unknown
}

function isSuccessEnvelope(payload: unknown): payload is SuccessEnvelope {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { success?: unknown }).success === true &&
    'data' in payload
  )
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    // Hono `HTTPException` (auth-middleware rejections) renders the message
    // as a plain-text body, not the `{ success, error }` envelope. Preserve
    // it so the error message stays actionable.
    return { __text: text }
  }
}

function errorCode(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null) {
    const error = (payload as { error?: { code?: unknown } }).error
    if (error && typeof error.code === 'string') return error.code
  }
  return status === 0 ? 'network_error' : 'http_error'
}

function errorMessage(payload: unknown, endpointLabel: string, status: number): string {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as { error?: { message?: unknown }; __text?: unknown }
    if (record.error && typeof record.error.message === 'string') {
      return `${endpointLabel} → ${status}: ${record.error.message}`
    }
    if (typeof record.__text === 'string' && record.__text.length > 0) {
      return `${endpointLabel} → ${status}: ${record.__text.slice(0, 300)}`
    }
  }
  return `${endpointLabel} → ${status}`
}

/** Linear backoff — 200ms, 400ms, … — capped implicitly by `maxAttempts`. */
function delay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 200))
}
