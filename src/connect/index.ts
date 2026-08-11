/**
 * @stable Cross-product connect flow.
 *
 * A product app (legal, tax, gtm, creative, agent-builder, sandbox, …) that
 * is already part of the Tangle trusted-app registry on id.tangle.tools
 * routes its users through this flow to obtain an `sk-tan-*` API key bound
 * to the calling user. The shape mirrors the platform's `/cross-site/*`
 * routes one-for-one so consumers can swap a bespoke fetch loop for these
 * helpers without changing the wire protocol.
 *
 * Three stages:
 *
 *   1. start({ appId, returnUrl, state }) → { authorizeUrl }
 *      The product redirects the user to `authorizeUrl`. id.tangle.tools
 *      checks the session cookie; if absent it punts to the login page
 *      with a callback back to /cross-site/authorize.
 *
 *   2. callback({ code, app, state }) → { keyId, apiKey?, user }
 *      id.tangle.tools redirects back to the product's `returnUrl` with
 *      `?code=…&app=…&state=…`. The product calls `finish()` with the
 *      code; the helper POSTs /cross-site/exchange and returns the stable
 *      key id, optional one-time secret, and identity. `state` is verified
 *      by the caller against its own
 *      session (we never see it twice; CSRF is the caller's responsibility
 *      per the platform contract — see `cross-site.ts` line 148).
 *
 *   3. revoke({ apiKey }) → void
 *      Revoke the credential. Wraps `tangleIdentity().revokeSession`.
 *
 * Storage: this module is stateless. Persistence of the minted key (per
 * user, per workspace) is the caller's job — it goes in whatever
 * encrypted-credentials store the product already runs (sandbox uses Redis,
 * gtm uses Postgres, blueprints uses CF KV). The recipe is identical to
 * sandbox/api/src/lib/platform-client.ts — caller supplies a store, this
 * module hands back the raw key once and never persists it. A replay returns
 * the stable key id without returning the secret again.
 *
 * Why not invent a new wire protocol: tcloud + sandbox already speak this
 * one against the live platform deployment. Diverging breaks the boundary
 * we maintain at the directive level ("DO NOT invent the wire protocol —
 * use what tcloud already does"). Every byte on the wire here matches a
 * test in `products/platform/api/tests/cross-site.test.ts`.
 */

import {
  createTangleIdentityClient,
  DEFAULT_TANGLE_PLATFORM_URL,
  TANGLE_API_KEY_PREFIX,
  TANGLE_BROKER_TOKEN_PREFIX,
  TangleIdentityUnreachableError,
  type TangleIdentityOptions,
  type TangleUserSummary,
} from '../connectors/adapters/tangle-id.js'
import {
  isRealNonPlaceholderEmail,
  PLATFORM_ACCESS_POLICY_VERSION,
} from '../billing-access-policy.js'

/** Request accepted by Platform's `/cross-site/exchange` route. */
export interface PlatformExchangeRequest {
  code: string
  app: string
}

/**
 * Platform's shared `ExchangeResponse` contract.
 *
 * `emailVerified` is intentionally top-level. Platform checks eligibility
 * before it consumes the code or replaces the product key. The nested user
 * object does not contain another verification flag.
 */
export interface PlatformExchangeResponse {
  apiKey?: string
  keyId: string
  paidAccessPolicyVersion: typeof PLATFORM_ACCESS_POLICY_VERSION
  emailVerified: true
  user: {
    id: string
    email: string
    name?: string | null
    image?: string | null
  }
  subscription?: {
    plan: 'free' | 'pro' | 'enterprise'
    sandboxTier: 'free' | 'pro' | 'enterprise'
    routerTier: 'free' | 'pro' | 'enterprise'
    status: string
    currentPeriodEnd: string | null
  }
  balance: 0
}

export interface ConnectFlowOptions extends TangleIdentityOptions {
  /** Base URL of id.tangle.tools (defaults to {@link DEFAULT_TANGLE_PLATFORM_URL}). */
  baseUrl?: string
}

export interface StartConnectInput {
  /** Trusted app id (registered on id.tangle.tools — `evals`, `sandbox`,
   *  `agent-builder`, `tax-agent`, `legal-agent`, …). */
  appId: string
  /** Caller-generated CSRF nonce. The caller stashes it in its own
   *  session/cookie store; on the callback it MUST be compared against
   *  the `state` returned in the redirect. */
  state: string
  /** Optional exact-match override of the registered callback URI. When
   *  omitted, the platform falls back to the app's first registered
   *  redirectUri. When provided, MUST equal one of the registered entries
   *  (origin + pathname) — otherwise the platform refuses the flow. */
  redirectUri?: string
}

export interface StartConnectOutput {
  /** The URL to redirect the user's browser to. */
  authorizeUrl: string
}

export interface FinishConnectInput {
  /** Auth code returned by id.tangle.tools on the callback redirect. */
  code: string
  /** Same `appId` passed to `start()`. */
  appId: string
}

export interface FinishConnectOutput {
  /** Stable Platform key id. Persist this even when a replay omits the secret. */
  keyId: string
  /** Newly minted secret. Platform intentionally omits it on a replay. */
  apiKey?: string
  /** Identity hydrated from the exchange response. */
  user: TangleUserSummary
  /** Initial balance the platform returns alongside the key. */
  balance: number
  /** Versioned proof that Platform applied its current access policy. */
  paidAccessPolicyVersion: typeof PLATFORM_ACCESS_POLICY_VERSION
}

/** Initiate a cross-product connect flow. Returns the URL the product
 *  app should redirect the user's browser to. */
export function startConnectFlow(
  opts: ConnectFlowOptions,
  input: StartConnectInput,
): StartConnectOutput {
  if (!input.appId) {
    throw new TangleIdentityUnreachableError('connect/start: appId is required')
  }
  if (!input.state) {
    throw new TangleIdentityUnreachableError(
      'connect/start: state is required for CSRF protection (matches the platform contract)',
    )
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_TANGLE_PLATFORM_URL).replace(/\/+$/, '')
  const url = new URL(`${baseUrl}/cross-site/authorize`)
  url.searchParams.set('app', input.appId)
  url.searchParams.set('state', input.state)
  if (input.redirectUri) url.searchParams.set('redirect', input.redirectUri)
  return { authorizeUrl: url.toString() }
}

/** Finish a cross-product connect flow. Calls /cross-site/exchange and
 *  returns the stable key binding plus hydrated user identity. */
export async function finishConnectFlow(
  opts: ConnectFlowOptions,
  input: FinishConnectInput,
): Promise<FinishConnectOutput> {
  if (!input.code) {
    throw new TangleIdentityUnreachableError('connect/finish: code is required')
  }
  if (!input.appId) {
    throw new TangleIdentityUnreachableError('connect/finish: appId is required')
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_TANGLE_PLATFORM_URL).replace(/\/+$/, '')
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 5_000
  let res: Response
  try {
    res = await fetchImpl(`${baseUrl}/cross-site/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: input.code,
        app: input.appId,
      } satisfies PlatformExchangeRequest),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new TangleIdentityUnreachableError('connect/finish: exchange request failed', { cause: err })
  }
  if (res.status === 401) {
    throw new TangleIdentityUnreachableError(
      'connect/finish: exchange code rejected — replay, expired, or wrong app',
      { status: 401 },
    )
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new TangleIdentityUnreachableError(
      `connect/finish: /cross-site/exchange returned ${res.status}: ${detail.slice(0, 200)}`,
      { status: res.status },
    )
  }
  const body = (await res.json().catch(() => null)) as Partial<PlatformExchangeResponse> | null
  if (
    !body ||
    (body.apiKey !== undefined && !isNonEmptyTangleApiKey(body.apiKey)) ||
    typeof body.keyId !== 'string' ||
    !body.keyId.trim() ||
    body.paidAccessPolicyVersion !== PLATFORM_ACCESS_POLICY_VERSION ||
    body.emailVerified !== true ||
    !body.user ||
    typeof body.user.id !== 'string' ||
    !body.user.id.trim() ||
    !isRealNonPlaceholderEmail(body.user.email) ||
    body.balance !== 0
  ) {
    throw new TangleIdentityUnreachableError(
      'connect/finish: Platform returned an invalid exchange contract',
      { status: 403 },
    )
  }
  return {
    keyId: body.keyId,
    ...(body.apiKey ? { apiKey: body.apiKey } : {}),
    user: {
      id: body.user.id,
      email: body.user.email,
      emailVerified: true,
      ...(body.user.name !== undefined ? { name: body.user.name } : {}),
      ...(body.user.image !== undefined ? { image: body.user.image } : {}),
    },
    balance: 0,
    paidAccessPolicyVersion: PLATFORM_ACCESS_POLICY_VERSION,
  }
}

/** Revoke a minted API key. Idempotent — re-revoking a stale key is a no-op. */
export async function revokeConnectFlow(
  opts: ConnectFlowOptions,
  input: { apiKey: string },
): Promise<void> {
  if (!isNonEmptyTangleApiKey(input.apiKey)) {
    throw new TangleIdentityUnreachableError('connect/revoke: apiKey is required')
  }
  const client = createTangleIdentityClient(opts)
  await client.revokeSession(input.apiKey)
}

function isNonEmptyTangleApiKey(value: unknown): value is string {
  return typeof value === 'string' &&
    value.startsWith(TANGLE_API_KEY_PREFIX) &&
    !value.startsWith(TANGLE_BROKER_TOKEN_PREFIX) &&
    value.length > TANGLE_API_KEY_PREFIX.length
}

/**
 * Convenience: build a tiny session manager keyed by `state` for products
 * that don't already have a CSRF store. NOT recommended for production —
 * use your existing session cookie / signed-state mechanism. Exposed for
 * tests and for quick prototyping. In-memory; not shared across workers.
 */
export class InMemoryConnectStateStore {
  private readonly entries = new Map<string, { appId: string; expiresAt: number }>()

  put(state: string, value: { appId: string; ttlMs?: number }): void {
    this.entries.set(state, {
      appId: value.appId,
      expiresAt: Date.now() + (value.ttlMs ?? 10 * 60_000),
    })
  }

  consume(state: string): { appId: string } | undefined {
    const entry = this.entries.get(state)
    this.entries.delete(state)
    if (!entry || entry.expiresAt <= Date.now()) return undefined
    return { appId: entry.appId }
  }

  /** Test-only — drop pending state between unit-test runs. */
  clear(): void {
    this.entries.clear()
  }
}
