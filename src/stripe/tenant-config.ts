/**
 * Per-tenant Stripe configuration routing.
 *
 * Five product agents (legal, tax, gtm, creative, agent-builder) each
 * own a SEPARATE Stripe account. Reasons we pay the multi-account tax
 * rather than billing everyone through a single Tangle Stripe account:
 *
 *  1. Each product is a different LLC/legal entity for tax + dispute
 *     handling. Customer chargebacks land on the product's account.
 *  2. Stripe Tax + Atlas are per-account; we can't share a single
 *     Tax-collection setup across five SaaS products.
 *  3. Each product has its own pricing experiments; sharing one account
 *     would force a shared products/prices namespace and surface
 *     leak risk in the Stripe dashboard.
 *
 * The routing table maps `productId` (a Tangle-internal stable
 * identifier) to:
 *   - Stripe Secret Key  (`sk_live_…` or `rk_live_…`)
 *   - Webhook signing secret (`whsec_…`) — used by the WebhookRouter's
 *     `resolveSecret` callback.
 *   - Optional success/cancel URL defaults the product wants used
 *     unless the caller overrides per-checkout.
 *
 * Env-var convention is `STRIPE_SK_<PRODUCT_UPPER>` and
 * `STRIPE_WHSEC_<PRODUCT_UPPER>` — the resolver below honors that by
 * default. Consumers that store keys in a vault (Doppler, AWS Secrets
 * Manager) inject their own `TenantConfigResolver` instead.
 *
 * Critical invariant: this module NEVER caches resolved keys across
 * `getStripeClient()` calls without the consumer opting in. Stripe
 * encourages key rotation (Atlas docs); a cached `sk_…` outlives the
 * rotation. The default `EnvTenantConfigResolver` re-reads env every
 * call. Consumers that want a memoized cache wrap with
 * `memoizeResolver(resolver, ttlMs)`.
 */

import { ConfigError } from './errors.js'

/** Stable product identifiers — kept in sync with the product registry.
 *  Adding a product is a one-line addition; we centralize so a typo at
 *  a call site (`'legal-agent'` vs `'legal'`) is a type error. */
export type ProductId =
  | 'legal'
  | 'tax'
  | 'gtm'
  | 'creative'
  | 'agent-builder'

export const PRODUCT_IDS: readonly ProductId[] = Object.freeze([
  'legal',
  'tax',
  'gtm',
  'creative',
  'agent-builder',
])

export interface TenantStripeConfig {
  productId: ProductId
  /** Stripe API secret key. Treat as opaque — do NOT log. */
  secretKey: string
  /** Webhook signing secret (`whsec_...`). */
  webhookSecret: string
  /** Optional default URLs the checkout/portal generators fall back to. */
  successUrl?: string
  cancelUrl?: string
  /** Free-form metadata threaded through to the product (e.g., the
   *  Connect account id if you later migrate to Connect). */
  metadata?: Record<string, string>
}

/** Stateless resolver — called per `getStripeClient()` / `resolveSecret()`.
 *  Implementations: read from env (default), read from a vault, read
 *  from a workspace-scoped DB row (per-tenant Connect). */
export interface TenantConfigResolver {
  resolve(productId: ProductId): Promise<TenantStripeConfig | null> | TenantStripeConfig | null
}

/* ---------------------------------------------------------------------- */
/*                              env resolver                               */
/* ---------------------------------------------------------------------- */

/**
 * Reads `STRIPE_SK_<PRODUCT>` + `STRIPE_WHSEC_<PRODUCT>` from
 * `process.env`. Product id is upper-snake-cased (`agent-builder` →
 * `AGENT_BUILDER`).
 *
 * Optional defaults:
 *   STRIPE_SUCCESS_URL_<PRODUCT>
 *   STRIPE_CANCEL_URL_<PRODUCT>
 */
export class EnvTenantConfigResolver implements TenantConfigResolver {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  resolve(productId: ProductId): TenantStripeConfig | null {
    const key = envKey(productId)
    const sk = this.env[`STRIPE_SK_${key}`]
    const wh = this.env[`STRIPE_WHSEC_${key}`]
    if (!sk || !wh) return null
    return {
      productId,
      secretKey: sk,
      webhookSecret: wh,
      successUrl: this.env[`STRIPE_SUCCESS_URL_${key}`],
      cancelUrl: this.env[`STRIPE_CANCEL_URL_${key}`],
    }
  }
}

/**
 * Static resolver — pass a hardcoded map, useful for tests and for
 * deployments that pull from a vault at boot.
 */
export class StaticTenantConfigResolver implements TenantConfigResolver {
  constructor(private readonly table: Partial<Record<ProductId, TenantStripeConfig>>) {}
  resolve(productId: ProductId): TenantStripeConfig | null {
    return this.table[productId] ?? null
  }
}

/**
 * Memoize a resolver with a TTL. Used in production to avoid pounding
 * a remote vault on every webhook. Default 60s — short enough that a
 * key rotation lands within the next minute.
 */
export function memoizeResolver(inner: TenantConfigResolver, ttlMs = 60_000): TenantConfigResolver {
  const cache = new Map<ProductId, { config: TenantStripeConfig | null; expiresAt: number }>()
  return {
    async resolve(productId: ProductId) {
      const now = Date.now()
      const hit = cache.get(productId)
      if (hit && hit.expiresAt > now) return hit.config
      const config = await inner.resolve(productId)
      cache.set(productId, { config, expiresAt: now + ttlMs })
      return config
    },
  }
}

/* ---------------------------------------------------------------------- */
/*                         the Stripe client handle                        */
/* ---------------------------------------------------------------------- */

/**
 * Thin Stripe HTTP client handle. We do NOT depend on the `stripe`
 * npm package — same rationale as `stripe-pack`: keep the install
 * footprint zero, use `fetch` directly. The handle carries the
 * resolved secret + a Stripe-spec base URL so call sites can issue
 * scoped requests without re-resolving for every operation in a
 * batch.
 *
 * Idempotency-Key forwarding: every mutation MUST include an
 * `idempotency-key` header. Stripe enforces a 24h replay window
 * keyed off it. The `mutate()` helper accepts the key explicitly to
 * make it impossible to forget.
 */
export interface StripeClient {
  productId: ProductId
  config: TenantStripeConfig
  /** GET request — returns parsed JSON or throws on non-2xx. */
  get<T = unknown>(path: string, query?: Record<string, string>): Promise<T>
  /** Form-urlencoded POST/DELETE with idempotency. */
  mutate<T = unknown>(
    method: 'POST' | 'DELETE',
    path: string,
    body: Record<string, string | number | boolean | undefined>,
    idempotencyKey: string,
  ): Promise<T>
}

const STRIPE_API = 'https://api.stripe.com/v1'

/**
 * Look up the Stripe client for a product. Throws `ConfigError` if the
 * resolver returns null — the product agent fails its startup health
 * check and the deploy is held back. NEVER silently falls back to a
 * shared key.
 */
export async function getStripeClient(
  productId: ProductId,
  resolver: TenantConfigResolver,
): Promise<StripeClient> {
  const config = await resolver.resolve(productId)
  if (!config) {
    throw new ConfigError({
      message: `Stripe not configured for product '${productId}'. Set STRIPE_SK_${envKey(productId)} and STRIPE_WHSEC_${envKey(productId)}.`,
      context: { productId },
    })
  }
  return buildClient(config)
}

/** Build a client from an already-resolved config — for callers that
 *  manage resolution themselves (e.g., long-lived workers that
 *  resolved at startup). */
export function buildStripeClient(config: TenantStripeConfig): StripeClient {
  return buildClient(config)
}

function buildClient(config: TenantStripeConfig): StripeClient {
  const auth = `Bearer ${config.secretKey}`
  return {
    productId: config.productId,
    config,
    async get<T>(path: string, query?: Record<string, string>): Promise<T> {
      const qs = query ? `?${new URLSearchParams(query).toString()}` : ''
      const res = await fetch(`${STRIPE_API}${path}${qs}`, {
        headers: { authorization: auth },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`stripe ${path} ${res.status}: ${text.slice(0, 200)}`)
      }
      return (await res.json()) as T
    },
    async mutate<T>(
      method: 'POST' | 'DELETE',
      path: string,
      body: Record<string, string | number | boolean | undefined>,
      idempotencyKey: string,
    ): Promise<T> {
      const form = new URLSearchParams()
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue
        form.set(k, String(v))
      }
      const init: RequestInit = {
        method,
        headers: {
          authorization: auth,
          'idempotency-key': idempotencyKey,
          ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      }
      if (method === 'POST') init.body = form
      const res = await fetch(`${STRIPE_API}${path}`, init)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`stripe ${path} ${res.status}: ${text.slice(0, 200)}`)
      }
      return (await res.json()) as T
    },
  }
}

/**
 * `WebhookRouter.resolveSecret` adapter. The router calls this with
 * the provider id and headers; we extract the product id from a
 * header the gateway routes by (`x-tangle-product`) and look it up.
 *
 * Why a header and not the URL path: the router is provider-keyed,
 * not product-keyed, by design. Products inject the header in their
 * gateway layer (Hono middleware in our case). The header is
 * authenticated as part of the gateway's edge auth — Stripe's own
 * signature still has to verify against the secret we return here,
 * so a forged header alone can't bypass anything.
 */
export function makeStripeSecretResolver(resolver: TenantConfigResolver) {
  return async function resolveSecret(
    providerId: string,
    headers: { [name: string]: string | string[] | undefined },
  ): Promise<string | null> {
    if (providerId !== 'stripe') return null
    const productHeader = headers['x-tangle-product']
    const productId = Array.isArray(productHeader) ? productHeader[0] : productHeader
    if (!productId || !isProductId(productId)) return null
    const config = await resolver.resolve(productId)
    return config?.webhookSecret ?? null
  }
}

function isProductId(s: string): s is ProductId {
  return (PRODUCT_IDS as readonly string[]).includes(s)
}

function envKey(productId: ProductId): string {
  return productId.toUpperCase().replace(/-/g, '_')
}
