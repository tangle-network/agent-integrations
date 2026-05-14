/**
 * @stable Drop-in request middleware that verifies id.tangle.tools
 * credentials and attaches `{ userId, workspaceId, scopes, kind }` to the
 * request.
 *
 * The middleware is framework-agnostic. Instead of binding to express /
 * hono / itty-router specifically (each has its own request typings and
 * lifecycle), the helper accepts either a `Request` (web standard) or a
 * `{ headers }`-shaped object and returns a typed result the caller wires
 * into its own context. Concrete adapters for hono / express / fetch live
 * one call below in the same module so a product can pick the shape it
 * uses without dragging in framework types from the rest.
 *
 * Why this matters: legal-agent runs on Bun + Hono. tax-agent runs on
 * CF Workers + itty-router. gtm-agent runs on Node + Express. Wiring an
 * identical "is this caller authed" check across all three is what
 * unblocks shipping product apps in parallel.
 *
 * Token sources (checked in order):
 *
 *   1. `Authorization: Bearer <token>` — handles both sk-tan-* API keys
 *      and Better Auth-issued session bearers.
 *   2. `Cookie: better-auth.session_token=<jwt>` — the canonical browser
 *      flow. We forward the cookie value as a Bearer to the platform's
 *      `/api/auth/get-session` endpoint.
 *
 * On success the middleware returns:
 *
 *   { ok: true, auth: { userId, workspaceId, scopes, kind, expiresAt? } }
 *
 * On failure:
 *
 *   { ok: false, status: 401|403, reason: '<stable-code>' }
 *
 * The caller decides whether to short-circuit the request (production) or
 * downgrade to anonymous (read-only public endpoints). The middleware
 * NEVER throws on bad-token; only true platform unreachability bubbles up
 * as a `TangleIdentityUnreachableError`.
 */

import {
  createTangleIdentityClient,
  TangleIdentityUnreachableError,
  type TangleIdentityClient,
  type TangleIdentityOptions,
  type TangleTokenVerifyFailure,
  type TangleTokenVerifyResult,
} from '../connectors/adapters/tangle-id.js'

/** Auth context the middleware attaches to the request on success. */
export interface TangleAuthContext {
  userId: string
  workspaceId: string
  scopes: string[]
  kind: 'api_key' | 'session'
  /** Wall-clock ms epoch when the credential expires, when known. */
  expiresAt?: number
  /** Stable credential id (key id for API keys, session id for sessions). */
  credentialId?: string
  /** Owner-shape on the platform side. */
  ownerType: 'user' | 'team'
  /** Product the credential is scoped to, when known. */
  product?: string
}

export type TangleAuthOutcome =
  | { ok: true; auth: TangleAuthContext }
  | { ok: false; status: 401 | 403 | 503; reason: TangleAuthReason }

/** Stable failure reasons surfaced to the caller. */
export type TangleAuthReason =
  | 'missing_credential'
  | 'malformed_credential'
  | 'service_token_refused'
  | TangleTokenVerifyFailure
  | 'platform_unreachable'

export interface RequireTangleAuthOptions extends TangleIdentityOptions {
  /** Pre-built client. When supplied, all `TangleIdentityOptions` fields
   *  are ignored. Tests pass a stub here; production code typically
   *  constructs the client once at boot and passes it in. */
  client?: TangleIdentityClient
  /** Override the cookie name where the session bearer lives. Defaults
   *  to `better-auth.session_token` — matches the platform's Better Auth
   *  configuration. */
  sessionCookieName?: string
  /** If true, missing-credential returns `ok: false, status: 401`
   *  (default). If false, the middleware returns `ok: true` with a
   *  synthetic anonymous context — useful for public endpoints that want
   *  to opportunistically hydrate identity. */
  requireCredential?: boolean
}

/**
 * Verify the credential on `request` against id.tangle.tools and resolve
 * to a typed {@link TangleAuthContext}. Request type is the web-standard
 * `Request` shape — works in Bun, Workers, Deno, Node 20+, Hono context's
 * `c.req.raw`, and Express adapters that surface `req` via `webRequest()`.
 */
export async function requireTangleAuth(
  request: Pick<Request, 'headers'>,
  opts: RequireTangleAuthOptions = {},
): Promise<TangleAuthOutcome> {
  const client = opts.client ?? createTangleIdentityClient(opts)
  const requireCredential = opts.requireCredential !== false

  const token = extractToken(request, opts.sessionCookieName)
  if (!token) {
    if (!requireCredential) {
      return {
        ok: true,
        auth: {
          userId: '',
          workspaceId: '',
          scopes: [],
          kind: 'session',
          ownerType: 'user',
        },
      }
    }
    return { ok: false, status: 401, reason: 'missing_credential' }
  }

  let result: TangleTokenVerifyResult
  try {
    result = await client.verifyToken(token)
  } catch (err) {
    if (err instanceof TangleIdentityUnreachableError) {
      return { ok: false, status: 503, reason: 'platform_unreachable' }
    }
    throw err
  }

  if (!result.valid) {
    const status = result.reason === 'service_token_refused' ? 403 : 401
    return { ok: false, status, reason: result.reason }
  }

  return {
    ok: true,
    auth: {
      userId: result.userId,
      workspaceId: result.workspaceId,
      scopes: result.scopes,
      kind: result.kind,
      ownerType: result.ownerType,
      ...(result.expiresAt !== undefined ? { expiresAt: result.expiresAt } : {}),
      ...(result.credentialId ? { credentialId: result.credentialId } : {}),
      ...(result.product ? { product: result.product } : {}),
    },
  }
}

/**
 * Extract the bearer credential from a request. Public so callers that
 * want to reuse the same token-discovery logic outside the middleware
 * (e.g. to attribute audit log entries) don't have to re-implement it.
 *
 * Order: Authorization header first (canonical), session cookie second.
 * Service tokens (`svc_*`) are explicitly dropped — the platform's
 * middleware refuses to map them to a user, so accepting them here
 * would invite the exact "service-as-user" privilege escalation the
 * platform's `resolveServiceIdentity` already guards against.
 */
export function extractToken(
  request: Pick<Request, 'headers'>,
  sessionCookieName = 'better-auth.session_token',
): string | undefined {
  const headers = request.headers
  const authHeader = headerValue(headers, 'authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const candidate = authHeader.slice(7).trim()
    if (!candidate) return undefined
    if (candidate.startsWith('svc_')) return undefined
    return candidate
  }
  const cookieHeader = headerValue(headers, 'cookie')
  if (cookieHeader) {
    const token = readCookie(cookieHeader, sessionCookieName)
    if (token) return token
  }
  return undefined
}

function headerValue(headers: Headers | Record<string, string | string[] | undefined>, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined
  }
  const lookup = (headers as Record<string, unknown>)[name] ?? (headers as Record<string, unknown>)[name.toLowerCase()]
  if (Array.isArray(lookup)) return typeof lookup[0] === 'string' ? lookup[0] : undefined
  return typeof lookup === 'string' ? lookup : undefined
}

function readCookie(cookieHeader: string, name: string): string | undefined {
  // Cookies are semicolon-delimited; we DON'T URL-decode the value because
  // Better Auth's signed-cookie format includes `.` and `=` that survive
  // unencoded through the standard cookie parser. Matching by exact name=
  // prefix keeps us protocol-correct.
  const target = `${name}=`
  for (const piece of cookieHeader.split(';')) {
    const trimmed = piece.trim()
    if (!trimmed.startsWith(target)) continue
    return trimmed.slice(target.length)
  }
  return undefined
}

/**
 * Hono-flavored convenience wrapper. Returns a hono middleware factory
 * that calls {@link requireTangleAuth} and stashes the result on the
 * Hono context under `c.set('tangleAuth', auth)`. On failure short-
 * circuits with the canonical {success:false} envelope the platform uses.
 *
 * Kept typed against a structural `Context`-like shape so this module
 * does NOT take a hono peerDep. Consumers pass `c` directly.
 */
export function honoTangleAuthMiddleware(opts: RequireTangleAuthOptions = {}) {
  return async function tangleAuthHandler(
    c: HonoLikeContext,
    next: () => Promise<void>,
  ): Promise<Response | void> {
    const outcome = await requireTangleAuth(c.req.raw, opts)
    if (!outcome.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: outcome.reason.toUpperCase(), message: outcome.reason },
        }),
        {
          status: outcome.status,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
    c.set('tangleAuth', outcome.auth)
    await next()
  }
}

/** Minimal Hono Context-shaped surface. Avoids the hono peerDep. */
export interface HonoLikeContext {
  req: { raw: Request }
  set(key: 'tangleAuth', value: TangleAuthContext): void
}

/**
 * Express-flavored convenience wrapper. Same outcome shape as the Hono
 * helper, expressed via the Node `req` / `res` / `next` triple. Consumers
 * pass the triple as positional args. Returns a function compatible with
 * any express-like `app.use(fn)`.
 */
export function expressTangleAuthMiddleware(opts: RequireTangleAuthOptions = {}) {
  return async function tangleAuthHandler(
    req: ExpressLikeRequest,
    res: ExpressLikeResponse,
    next: (err?: unknown) => void,
  ): Promise<void> {
    // Build a `Request`-compatible header view from express's
    // `IncomingMessage.headers` map — string | string[] | undefined.
    const headers: Record<string, string | string[] | undefined> = req.headers ?? {}
    const outcome = await requireTangleAuth({ headers: headers as never }, opts)
    if (!outcome.ok) {
      res.status(outcome.status)
      res.setHeader?.('content-type', 'application/json')
      res.end(JSON.stringify({
        success: false,
        error: { code: outcome.reason.toUpperCase(), message: outcome.reason },
      }))
      return
    }
    req.tangleAuth = outcome.auth
    next()
  }
}

/** Minimal Express-shaped surfaces. Avoids the express peerDep. */
export interface ExpressLikeRequest {
  headers: Record<string, string | string[] | undefined>
  tangleAuth?: TangleAuthContext
}
export interface ExpressLikeResponse {
  status(code: number): unknown
  setHeader?(name: string, value: string): unknown
  end(body: string): unknown
}
