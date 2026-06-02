/**
 * @stable Tangle Identity — `id.tangle.tools` connector + verifier.
 *
 * This is the *identity* substrate every Tangle product (legal, tax, gtm,
 * creative, agent-builder, sandbox, evals, …) sits on. The shape mirrors
 * what `tcloud` and the sandbox `PlatformClient` already implement against
 * the platform repo at `agent-dev-container-collab-m1/products/platform`,
 * so consumers can switch from a hand-rolled fetch loop to this adapter
 * without changing the wire protocol.
 *
 * What it covers, end-to-end:
 *
 *   verify_token({ token })
 *     → { kind: 'api_key' | 'session', valid, userId?, workspaceId?, scopes, expiresAt? }
 *     Verifies a single credential. Two token shapes are recognized:
 *       - `sk-tan-*` API keys — POST /v1/keys/verify with the service token.
 *         Returns `userId`, `keyId`, `product`, granted scopes (`allowedModels`
 *         + product flag), and budget metadata.
 *       - Better Auth session cookies / Bearer session tokens — GET
 *         /api/auth/get-session with the credential forwarded as-is.
 *         Returns the user row.
 *     Wrong-issuer / tampered / expired all surface as `{ valid: false }`
 *     with a stable `reason`. Never throws on bad-token; only throws when
 *     id.tangle.tools itself is unreachable or returns a 5xx (lets callers
 *     fail closed without confusing token failures with platform failures).
 *
 *   get_user({ userId })
 *     → { id, email, name?, image? }
 *     Read-only profile lookup. Service-token authenticated. Used by
 *     `requireTangleAuth` middleware to hydrate the request context when
 *     a downstream wants the user's email without re-verifying.
 *
 *   list_workspaces({ userId })
 *     → { workspaces: [{ id, name, role, isPersonal }] }
 *     A workspace = a Tangle team. Personal workspace is rendered with
 *     `isPersonal: true` (own id === userId on the platform schema).
 *     Mirrors `GET /v1/teams` on the platform side.
 *
 *   switch_workspace({ workspaceId })
 *     → { ok: true, workspaceId, scopes }
 *     Stateless on this adapter — the caller persists the workspaceId in
 *     its own session. The connector returns the workspace's effective
 *     scope set so the caller can immediately filter capability discovery
 *     against the new workspace's grant matrix.
 *
 *   revoke_session({ token })
 *     → { ok: true }
 *     For session tokens: POST /api/auth/sign-out. For API keys: DELETE
 *     /v1/keys/{id}. The adapter detects the kind from the prefix.
 *
 * Auth:
 *   - **Service token** (`Bearer svc_*`) is required for `verify_token` of
 *     `sk-tan-*` keys, `get_user`, `list_workspaces`, and `revoke_session`
 *     of API keys.
 *   - **Session cookie / Bearer session** is forwarded as-is for session
 *     verification and session revocation.
 *
 * The adapter is stateless. Caller resolves `serviceToken` + `baseUrl` from
 * env (`TANGLE_PLATFORM_URL`, `TANGLE_SERVICE_TOKEN`) and passes them at
 * construction. The adapter never reads from `process.env` itself — this
 * keeps it CF Worker compatible (no Node-only env semantics) and lets
 * tests inject a fake fetch + service token in one place.
 */

import {
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorInvocation,
  CredentialsExpired,
} from '../types.js'

/** Default platform URL (matches `DEFAULT_PLATFORM_URL` in tcloud). */
export const DEFAULT_TANGLE_PLATFORM_URL = 'https://id.tangle.tools'

/** Hard timeout for every outbound platform call. Matches sandbox's
 *  `PLATFORM_FETCH_TIMEOUT_MS` so a slow id.tangle.tools doesn't tie up
 *  the consumer's request handler. */
const PLATFORM_FETCH_TIMEOUT_MS = 5_000

/** API-key prefix the platform issues. Used to disambiguate token kind
 *  without a round-trip. */
export const TANGLE_API_KEY_PREFIX = 'sk-tan-'

/** Service-token prefix. Mirrored from the platform's middleware so we
 *  can refuse to forward service tokens through the user-session path. */
export const TANGLE_SERVICE_TOKEN_PREFIX = 'svc_'

export interface TangleIdentityOptions {
  /** Base URL of the id.tangle.tools deployment (no trailing slash). */
  baseUrl?: string
  /**
   * Service token (`svc_*`) used for S2S calls (verify, provision, etc.).
   * Required for API-key verification and the user/workspace read paths.
   * Omit only for session-only flows on a deployment that exposes those
   * routes unauthenticated (rare; never in production).
   */
  serviceToken?: string
  /** Service identity claimed in the `X-Service-Name` header. */
  serviceName?: string
  /** Injected fetch — defaults to global. Tests pass a vi mock. */
  fetchImpl?: typeof fetch
  /** Per-call timeout override (default {@link PLATFORM_FETCH_TIMEOUT_MS}). */
  timeoutMs?: number
}

/** Stable result of a token verification. `valid: false` is returned for
 *  every recognizable bad-token shape (expired, tampered, wrong issuer,
 *  unknown kind); only true platform unreachability throws. */
export type TangleTokenVerifyResult =
  | {
      valid: true
      kind: 'api_key' | 'session'
      userId: string
      /** Active workspace at the moment of issue, if the credential is
       *  workspace-scoped (team-owned API key). Personal credentials
       *  return the user's personal workspace (== `userId`). */
      workspaceId: string
      scopes: string[]
      /** Wall-clock ms epoch when the credential expires. Undefined for
       *  non-expiring credentials (most session cookies are sliding). */
      expiresAt?: number
      /** Stable id of the credential row, when known (key.id for API
       *  keys, session.id for sessions). Useful for revoke + audit. */
      credentialId?: string
      /** Product the credential is scoped to, when known. */
      product?: string
      /** Owner shape — `user` for personal credentials, `team` for
       *  team-owned API keys. Always matches the workspace's owner type. */
      ownerType: 'user' | 'team'
    }
  | {
      valid: false
      /** Stable reason code: `tampered`, `expired`, `revoked`,
       *  `wrong_issuer`, `unknown_kind`, `service_token_refused`. */
      reason: TangleTokenVerifyFailure
    }

export type TangleTokenVerifyFailure =
  | 'tampered'
  | 'expired'
  | 'revoked'
  | 'wrong_issuer'
  | 'unknown_kind'
  | 'service_token_refused'
  | 'malformed'

export interface TangleUserSummary {
  id: string
  email?: string
  name?: string | null
  image?: string | null
}

export interface TangleWorkspaceSummary {
  id: string
  name: string
  role: 'owner' | 'admin' | 'member'
  isPersonal: boolean
  /** Effective scope set for the calling user inside this workspace.
   *  Sourced from the team's plan + per-product policy on the platform. */
  scopes: string[]
}

/** Thrown when id.tangle.tools is unreachable or returns 5xx. NOT thrown
 *  for bad-token responses — those round-trip as `{ valid: false }`. */
export class TangleIdentityUnreachableError extends Error {
  override readonly name = 'TangleIdentityUnreachableError'
  readonly status?: number
  constructor(message: string, opts?: { status?: number; cause?: unknown }) {
    super(message, opts)
    this.status = opts?.status
  }
}

/** Build a `ConnectorAdapter` exposing id.tangle.tools as a first-party
 *  integration. The adapter participates in the standard discovery /
 *  capability gating loop, so a product can list identity ops alongside
 *  Gmail / Stripe / etc. in the same tool registry. */
export function tangleIdentity(opts: TangleIdentityOptions = {}): ConnectorAdapter {
  const client = createTangleIdentityClient(opts)
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'tangle-id',
      displayName: 'Tangle Identity',
      description:
        'Verify Tangle session cookies and API keys issued by id.tangle.tools, resolve user + workspace identity, and gate capability discovery against the calling workspace scopes.',
      auth: { kind: 'api-key', hint: 'Tangle platform service token (svc_*).' },
      category: 'other',
      defaultConsistencyModel: 'authoritative',
      // 50 req/s per service token matches the platform's documented
      // S2S budget. We meter on our side so a chatty product doesn't
      // burn the shared service-token quota and block the rest.
      rateLimit: { requests: 50, windowMs: 1_000, scope: 'oauth-client' },
      capabilities: [
        {
          name: 'verify_token',
          class: 'read',
          description:
            'Verify a session cookie or sk-tan-* API key. Returns { valid, userId, workspaceId, scopes, expiresAt } or { valid: false, reason }.',
          parameters: {
            type: 'object',
            properties: {
              token: { type: 'string', minLength: 1 },
            },
            required: ['token'],
          },
        },
        {
          name: 'get_user',
          class: 'read',
          description: 'Read the user profile (id, email, name, image) for a verified userId.',
          parameters: {
            type: 'object',
            properties: { userId: { type: 'string', minLength: 1 } },
            required: ['userId'],
          },
        },
        {
          name: 'list_workspaces',
          class: 'read',
          description: 'List workspaces (teams + the personal workspace) the user belongs to, with role + effective scopes.',
          parameters: {
            type: 'object',
            properties: { userId: { type: 'string', minLength: 1 } },
            required: ['userId'],
          },
        },
        {
          name: 'switch_workspace',
          class: 'mutation',
          description:
            'Resolve a workspace by id and return its effective scope set. Stateless on this adapter — caller persists the workspaceId in its own session store.',
          parameters: {
            type: 'object',
            properties: {
              userId: { type: 'string', minLength: 1 },
              workspaceId: { type: 'string', minLength: 1 },
            },
            required: ['userId', 'workspaceId'],
          },
          cas: 'native-idempotency',
          externalEffect: false,
        },
        {
          name: 'revoke_session',
          class: 'mutation',
          description: 'Revoke a session token or API key. Idempotent.',
          parameters: {
            type: 'object',
            properties: { token: { type: 'string', minLength: 1 } },
            required: ['token'],
          },
          cas: 'native-idempotency',
          externalEffect: true,
        },
        {
          name: 'workspaces.create',
          class: 'mutation',
          description:
            'Create a new workspace (team) owned by the calling user. Idempotent by display name + owner — re-issuing with the same name returns the existing workspace.',
          parameters: {
            type: 'object',
            properties: {
              userId: { type: 'string', minLength: 1 },
              name: { type: 'string', minLength: 1 },
              slug: { type: 'string', minLength: 1 },
            },
            required: ['userId', 'name'],
          },
          cas: 'native-idempotency',
          externalEffect: true,
        },
        {
          name: 'workspaces.delete',
          class: 'mutation',
          description:
            'Delete a workspace. Refuses to delete a user personal workspace. Idempotent: 404 is treated as a no-op.',
          parameters: {
            type: 'object',
            properties: { workspaceId: { type: 'string', minLength: 1 } },
            required: ['workspaceId'],
          },
          cas: 'native-idempotency',
          externalEffect: true,
        },
        {
          name: 'members.invite',
          class: 'mutation',
          description:
            'Invite a member to a workspace by email. Idempotent: re-inviting the same email returns the existing invitation.',
          parameters: {
            type: 'object',
            properties: {
              workspaceId: { type: 'string', minLength: 1 },
              email: { type: 'string', minLength: 3 },
              role: { type: 'string', enum: ['owner', 'admin', 'member'] },
            },
            required: ['workspaceId', 'email'],
          },
          cas: 'native-idempotency',
          externalEffect: true,
        },
        {
          name: 'members.remove',
          class: 'mutation',
          description:
            'Remove a member from a workspace by userId. Idempotent: 404 is treated as a no-op.',
          parameters: {
            type: 'object',
            properties: {
              workspaceId: { type: 'string', minLength: 1 },
              userId: { type: 'string', minLength: 1 },
            },
            required: ['workspaceId', 'userId'],
          },
          cas: 'native-idempotency',
          externalEffect: true,
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      if (inv.capabilityName === 'verify_token') {
        const token = readStringArg(inv.args, 'token')
        const result = await client.verifyToken(token)
        return { data: result, fetchedAt: Date.now() }
      }
      if (inv.capabilityName === 'get_user') {
        const userId = readStringArg(inv.args, 'userId')
        const user = await client.getUser(userId)
        return { data: user, fetchedAt: Date.now() }
      }
      if (inv.capabilityName === 'list_workspaces') {
        const userId = readStringArg(inv.args, 'userId')
        const workspaces = await client.listWorkspaces(userId)
        return { data: { workspaces }, fetchedAt: Date.now() }
      }
      throw new Error(`tangle-id: unknown read capability ${inv.capabilityName}`)
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      if (inv.capabilityName === 'switch_workspace') {
        const userId = readStringArg(inv.args, 'userId')
        const workspaceId = readStringArg(inv.args, 'workspaceId')
        const result = await client.switchWorkspace(userId, workspaceId)
        return {
          status: 'committed',
          data: result,
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'revoke_session') {
        const token = readStringArg(inv.args, 'token')
        await client.revokeSession(token)
        return {
          status: 'committed',
          data: { ok: true },
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'workspaces.create') {
        const userId = readStringArg(inv.args, 'userId')
        const name = readStringArg(inv.args, 'name')
        const slug = readOptionalStringArg(inv.args, 'slug')
        const workspace = await client.createWorkspace(userId, { name, slug })
        return {
          status: 'committed',
          data: workspace,
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'workspaces.delete') {
        const workspaceId = readStringArg(inv.args, 'workspaceId')
        await client.deleteWorkspace(workspaceId)
        return {
          status: 'committed',
          data: { ok: true, workspaceId },
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'members.invite') {
        const workspaceId = readStringArg(inv.args, 'workspaceId')
        const email = readStringArg(inv.args, 'email')
        const role = readOptionalRole(inv.args, 'role')
        const invitation = await client.inviteMember(workspaceId, email, role)
        return {
          status: 'committed',
          data: invitation,
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'members.remove') {
        const workspaceId = readStringArg(inv.args, 'workspaceId')
        const userId = readStringArg(inv.args, 'userId')
        await client.removeMember(workspaceId, userId)
        return {
          status: 'committed',
          data: { ok: true, workspaceId, userId },
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      throw new Error(`tangle-id: unknown mutation capability ${inv.capabilityName}`)
    },

    async test(source) {
      try {
        // Cheapest probe: hit the platform's /health endpoint. Doesn't
        // burn the service-token quota and proves the deployment is up.
        const ok = await client.ping()
        if (!ok) return { ok: false, reason: 'id.tangle.tools /health returned non-200' }
        return { ok: true }
      } catch (err) {
        if (err instanceof CredentialsExpired) {
          return { ok: false, reason: 'service token rejected — rotate TANGLE_SERVICE_TOKEN' }
        }
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
  return adapter
}

/** Low-level HTTP client used by the adapter. Exported so consumers
 *  (middleware, connect routes, custom apps) can hit id.tangle.tools
 *  without going through the connector pipeline. */
export interface TangleIdentityClient {
  verifyToken(token: string): Promise<TangleTokenVerifyResult>
  getUser(userId: string): Promise<TangleUserSummary>
  listWorkspaces(userId: string): Promise<TangleWorkspaceSummary[]>
  switchWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<{ ok: true; workspaceId: string; scopes: string[] }>
  revokeSession(token: string): Promise<void>
  /** Create a new workspace owned by `userId`. The platform's
   *  `POST /v1/teams` returns the persisted row. Idempotent on
   *  `(ownerId, name)` upstream; conflicts are unwrapped to the
   *  existing row, not surfaced as errors. */
  createWorkspace(
    userId: string,
    spec: { name: string; slug?: string },
  ): Promise<TangleWorkspaceSummary>
  /** Delete a workspace. Refuses to delete the user's personal
   *  workspace (the platform-side `/v1/teams/{id}` returns 409). */
  deleteWorkspace(workspaceId: string): Promise<void>
  /** Invite a member to a workspace by email. Idempotent: re-issuing
   *  the same invite returns the existing pending invitation row. */
  inviteMember(
    workspaceId: string,
    email: string,
    role?: TangleWorkspaceSummary['role'],
  ): Promise<TangleInvitationSummary>
  /** Remove a member from a workspace by `userId`. 404 is a no-op. */
  removeMember(workspaceId: string, userId: string): Promise<void>
  ping(): Promise<boolean>
}

export interface TangleInvitationSummary {
  id: string
  workspaceId: string
  email: string
  role: TangleWorkspaceSummary['role']
  status: 'pending' | 'accepted' | 'revoked'
}

export function createTangleIdentityClient(opts: TangleIdentityOptions = {}): TangleIdentityClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_TANGLE_PLATFORM_URL).replace(/\/+$/, '')
  const serviceToken = opts.serviceToken
  const serviceName = opts.serviceName ?? 'integrations'
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? PLATFORM_FETCH_TIMEOUT_MS

  function s2sHeaders(): Record<string, string> {
    if (!serviceToken) {
      throw new TangleIdentityUnreachableError(
        'tangle-id: serviceToken is required for service-to-service calls (verify, get_user, list_workspaces, revoke)',
      )
    }
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${serviceToken}`,
      'x-service-name': serviceName,
    }
  }

  async function jsonFetch(path: string, init: RequestInit): Promise<Response> {
    let res: Response
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw new TangleIdentityUnreachableError(
        `tangle-id: request to ${path} failed`,
        { cause: err },
      )
    }
    return res
  }

  async function readErrorDetail(res: Response): Promise<string> {
    try {
      const text = await res.text()
      return text.trim().slice(0, 200)
    } catch {
      return ''
    }
  }

  async function verifyApiKey(token: string): Promise<TangleTokenVerifyResult> {
    const res = await jsonFetch('/v1/keys/verify', {
      method: 'POST',
      headers: s2sHeaders(),
      body: JSON.stringify({ key: token }),
    })
    if (res.status === 401) {
      // Service token rejected — distinct from "token is bad". The
      // platform middleware refuses our svc_* credential. Surface that
      // as `service_token_refused` so the caller can rotate.
      return { valid: false, reason: 'service_token_refused' }
    }
    if (!res.ok) {
      throw new TangleIdentityUnreachableError(
        `tangle-id: /v1/keys/verify returned ${res.status}: ${await readErrorDetail(res)}`,
        { status: res.status },
      )
    }
    const body = (await res.json().catch(() => null)) as
      | {
          valid?: boolean
          userId?: string
          ownerId?: string
          ownerType?: 'user' | 'team'
          keyId?: string
          product?: string
          allowedModels?: unknown
          expiresAt?: string
        }
      | null
    if (!body || typeof body.valid !== 'boolean') {
      return { valid: false, reason: 'malformed' }
    }
    if (!body.valid || !body.userId) {
      return { valid: false, reason: 'revoked' }
    }
    const scopes = Array.isArray(body.allowedModels)
      ? body.allowedModels.filter((value): value is string => typeof value === 'string')
      : []
    if (body.product) scopes.push(`product:${body.product}`)
    const expiresAt =
      typeof body.expiresAt === 'string' && body.expiresAt
        ? Date.parse(body.expiresAt)
        : undefined
    return {
      valid: true,
      kind: 'api_key',
      userId: body.userId,
      workspaceId: body.ownerType === 'team' && body.ownerId ? body.ownerId : body.userId,
      ownerType: body.ownerType ?? 'user',
      scopes,
      ...(Number.isFinite(expiresAt) ? { expiresAt: expiresAt as number } : {}),
      ...(body.keyId ? { credentialId: body.keyId } : {}),
      ...(body.product ? { product: body.product } : {}),
    }
  }

  async function verifySession(token: string): Promise<TangleTokenVerifyResult> {
    // Better Auth's get-session endpoint accepts either:
    //   - Cookie header `better-auth.session_token=<jwt>` (browser flow)
    //   - Bearer token (mobile / CLI flow), which Better Auth's bearer
    //     plugin extracts and resolves to a session row.
    // We always send Bearer; the platform's auth handler treats absent
    // cookie + present Bearer identically.
    const res = await jsonFetch('/api/auth/get-session', {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    if (res.status === 401 || res.status === 403) {
      return { valid: false, reason: 'expired' }
    }
    if (!res.ok) {
      throw new TangleIdentityUnreachableError(
        `tangle-id: /api/auth/get-session returned ${res.status}: ${await readErrorDetail(res)}`,
        { status: res.status },
      )
    }
    const body = (await res.json().catch(() => null)) as
      | {
          user?: { id?: string; email?: string }
          session?: { id?: string; expiresAt?: string; activeTeamId?: string | null }
        }
      | null
    if (!body || !body.user || typeof body.user.id !== 'string') {
      return { valid: false, reason: 'expired' }
    }
    const expiresAtRaw = body.session?.expiresAt
    const expiresAt = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN
    return {
      valid: true,
      kind: 'session',
      userId: body.user.id,
      workspaceId: body.session?.activeTeamId || body.user.id,
      ownerType: body.session?.activeTeamId ? 'team' : 'user',
      scopes: [],
      ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
      ...(body.session?.id ? { credentialId: body.session.id } : {}),
    }
  }

  return {
    async verifyToken(token: string): Promise<TangleTokenVerifyResult> {
      if (!token || typeof token !== 'string') {
        return { valid: false, reason: 'malformed' }
      }
      if (token.startsWith(TANGLE_SERVICE_TOKEN_PREFIX)) {
        // Service tokens MUST NOT be accepted as user identity. The
        // platform middleware sets `authMethod: 'service_token'` and
        // refuses every user-bound route on that path; mirror the
        // refusal here so a misconfigured product can't accidentally
        // treat an svc_* as the calling user.
        return { valid: false, reason: 'service_token_refused' }
      }
      if (token.startsWith(TANGLE_API_KEY_PREFIX)) {
        return verifyApiKey(token)
      }
      // Anything else — treat as a session bearer (Better Auth-emitted
      // JWTs are opaque to us). Wrong-issuer / random-string lands
      // on the 401 path inside `verifySession` and round-trips as
      // `expired`. We do not pre-validate JWT signatures — only the
      // platform holds the signing secret.
      return verifySession(token)
    },

    async getUser(userId: string): Promise<TangleUserSummary> {
      if (!userId) {
        throw new TangleIdentityUnreachableError('tangle-id: getUser requires a non-empty userId')
      }
      const res = await jsonFetch(`/v1/users/${encodeURIComponent(userId)}`, {
        method: 'GET',
        headers: s2sHeaders(),
      })
      if (res.status === 404) {
        throw new TangleIdentityUnreachableError(`tangle-id: user ${userId} not found`, { status: 404 })
      }
      if (!res.ok) {
        throw new TangleIdentityUnreachableError(
          `tangle-id: /v1/users/${userId} returned ${res.status}: ${await readErrorDetail(res)}`,
          { status: res.status },
        )
      }
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { id?: string; email?: string; name?: string | null; image?: string | null } }
        | null
      const data = body?.data
      if (!data || typeof data.id !== 'string') {
        throw new TangleIdentityUnreachableError('tangle-id: /v1/users response had an invalid shape')
      }
      return {
        id: data.id,
        ...(typeof data.email === 'string' ? { email: data.email } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.image !== undefined ? { image: data.image } : {}),
      }
    },

    async listWorkspaces(userId: string): Promise<TangleWorkspaceSummary[]> {
      const res = await jsonFetch('/v1/teams', {
        method: 'GET',
        headers: { ...s2sHeaders(), 'x-platform-user-id': userId },
      })
      if (!res.ok) {
        throw new TangleIdentityUnreachableError(
          `tangle-id: /v1/teams returned ${res.status}: ${await readErrorDetail(res)}`,
          { status: res.status },
        )
      }
      const body = (await res.json().catch(() => null)) as
        | {
            success?: boolean
            data?: Array<{
              id?: string
              name?: string
              role?: string
              isPersonal?: boolean
              scopes?: unknown
            }>
          }
        | null
      const rows = Array.isArray(body?.data) ? body!.data : []
      const workspaces: TangleWorkspaceSummary[] = []
      for (const row of rows) {
        if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') continue
        const role: TangleWorkspaceSummary['role'] =
          row.role === 'owner' || row.role === 'admin' ? row.role : 'member'
        const scopes = Array.isArray(row.scopes)
          ? row.scopes.filter((value): value is string => typeof value === 'string')
          : []
        workspaces.push({
          id: row.id,
          name: row.name,
          role,
          isPersonal: Boolean(row.isPersonal) || row.id === userId,
          scopes,
        })
      }
      return workspaces
    },

    async switchWorkspace(userId, workspaceId) {
      const workspaces = await this.listWorkspaces(userId)
      const match = workspaces.find((w) => w.id === workspaceId)
      if (!match) {
        throw new TangleIdentityUnreachableError(
          `tangle-id: workspace ${workspaceId} not found for user ${userId}`,
          { status: 404 },
        )
      }
      return { ok: true, workspaceId: match.id, scopes: match.scopes }
    },

    async revokeSession(token: string): Promise<void> {
      if (!token) return
      if (token.startsWith(TANGLE_SERVICE_TOKEN_PREFIX)) {
        throw new TangleIdentityUnreachableError(
          'tangle-id: refusing to revoke a service token — rotate it instead',
        )
      }
      if (token.startsWith(TANGLE_API_KEY_PREFIX)) {
        // We don't know the key id until we verify; do that first so
        // revoke is keyed by id (the only thing the platform's DELETE
        // /v1/keys/{id} accepts). Bad-key responses are no-ops.
        const v = await verifyApiKey(token)
        if (!v.valid || !v.credentialId) return
        const res = await jsonFetch(`/v1/keys/${encodeURIComponent(v.credentialId)}`, {
          method: 'DELETE',
          headers: s2sHeaders(),
        })
        if (res.status === 404) return
        if (!res.ok) {
          throw new TangleIdentityUnreachableError(
            `tangle-id: DELETE /v1/keys/${v.credentialId} returned ${res.status}: ${await readErrorDetail(res)}`,
            { status: res.status },
          )
        }
        return
      }
      // Session token — Better Auth's sign-out endpoint accepts the
      // session via Bearer + Cookie. We forward the credential as-is.
      const res = await jsonFetch('/api/auth/sign-out', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: '{}',
      })
      // Better Auth returns 200 on a fresh sign-out and 200/401 on a
      // stale one; either way the session is no longer usable.
      if (res.status >= 500) {
        throw new TangleIdentityUnreachableError(
          `tangle-id: /api/auth/sign-out returned ${res.status}: ${await readErrorDetail(res)}`,
          { status: res.status },
        )
      }
    },

    async createWorkspace(userId, spec) {
      if (!userId) {
        throw new TangleIdentityUnreachableError(
          'tangle-id: createWorkspace requires a non-empty userId',
        )
      }
      const res = await jsonFetch('/v1/teams', {
        method: 'POST',
        headers: { ...s2sHeaders(), 'x-platform-user-id': userId },
        body: JSON.stringify({
          name: spec.name,
          ...(spec.slug ? { slug: spec.slug } : {}),
        }),
      })
      if (res.status === 401) {
        throw new CredentialsExpired(
          'tangle-id: service token rejected on POST /v1/teams',
          'tangle-id',
        )
      }
      if (!res.ok) {
        throw new TangleIdentityUnreachableError(
          `tangle-id: POST /v1/teams returned ${res.status}: ${await readErrorDetail(res)}`,
          { status: res.status },
        )
      }
      const body = (await res.json().catch(() => null)) as
        | {
            success?: boolean
            data?: { id?: string; name?: string; role?: string; isPersonal?: boolean; scopes?: unknown }
          }
        | null
      const data = body?.data
      if (!data || typeof data.id !== 'string' || typeof data.name !== 'string') {
        throw new TangleIdentityUnreachableError(
          'tangle-id: POST /v1/teams response had an invalid shape',
        )
      }
      const role: TangleWorkspaceSummary['role'] =
        data.role === 'owner' || data.role === 'admin' ? data.role : 'owner'
      const scopes = Array.isArray(data.scopes)
        ? data.scopes.filter((value): value is string => typeof value === 'string')
        : []
      return {
        id: data.id,
        name: data.name,
        role,
        isPersonal: Boolean(data.isPersonal) || data.id === userId,
        scopes,
      }
    },

    async deleteWorkspace(workspaceId) {
      if (!workspaceId) {
        throw new TangleIdentityUnreachableError(
          'tangle-id: deleteWorkspace requires a non-empty workspaceId',
        )
      }
      const res = await jsonFetch(`/v1/teams/${encodeURIComponent(workspaceId)}`, {
        method: 'DELETE',
        headers: s2sHeaders(),
      })
      if (res.status === 401) {
        throw new CredentialsExpired(
          'tangle-id: service token rejected on DELETE /v1/teams',
          'tangle-id',
        )
      }
      if (res.status === 404) return
      if (!res.ok) {
        throw new TangleIdentityUnreachableError(
          `tangle-id: DELETE /v1/teams/${workspaceId} returned ${res.status}: ${await readErrorDetail(res)}`,
          { status: res.status },
        )
      }
    },

    async inviteMember(workspaceId, email, role) {
      if (!workspaceId) {
        throw new TangleIdentityUnreachableError(
          'tangle-id: inviteMember requires a non-empty workspaceId',
        )
      }
      if (!email) {
        throw new TangleIdentityUnreachableError(
          'tangle-id: inviteMember requires a non-empty email',
        )
      }
      const res = await jsonFetch(
        `/v1/teams/${encodeURIComponent(workspaceId)}/invitations`,
        {
          method: 'POST',
          headers: s2sHeaders(),
          body: JSON.stringify({
            email,
            ...(role ? { role } : {}),
          }),
        },
      )
      if (res.status === 401) {
        throw new CredentialsExpired(
          'tangle-id: service token rejected on POST invitation',
          'tangle-id',
        )
      }
      if (!res.ok) {
        throw new TangleIdentityUnreachableError(
          `tangle-id: POST /v1/teams/${workspaceId}/invitations returned ${res.status}: ${await readErrorDetail(res)}`,
          { status: res.status },
        )
      }
      const body = (await res.json().catch(() => null)) as
        | {
            success?: boolean
            data?: {
              id?: string
              workspaceId?: string
              teamId?: string
              email?: string
              role?: string
              status?: string
            }
          }
        | null
      const data = body?.data
      if (!data || typeof data.id !== 'string') {
        throw new TangleIdentityUnreachableError(
          'tangle-id: POST invitation response had an invalid shape',
        )
      }
      const resolvedRole: TangleWorkspaceSummary['role'] =
        data.role === 'owner' || data.role === 'admin' ? data.role : 'member'
      const status: TangleInvitationSummary['status'] =
        data.status === 'accepted' || data.status === 'revoked' ? data.status : 'pending'
      return {
        id: data.id,
        workspaceId: data.workspaceId ?? data.teamId ?? workspaceId,
        email: data.email ?? email,
        role: resolvedRole,
        status,
      }
    },

    async removeMember(workspaceId, userId) {
      if (!workspaceId || !userId) {
        throw new TangleIdentityUnreachableError(
          'tangle-id: removeMember requires non-empty workspaceId and userId',
        )
      }
      const res = await jsonFetch(
        `/v1/teams/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
          headers: s2sHeaders(),
        },
      )
      if (res.status === 401) {
        throw new CredentialsExpired(
          'tangle-id: service token rejected on DELETE member',
          'tangle-id',
        )
      }
      if (res.status === 404) return
      if (!res.ok) {
        throw new TangleIdentityUnreachableError(
          `tangle-id: DELETE /v1/teams/${workspaceId}/members/${userId} returned ${res.status}: ${await readErrorDetail(res)}`,
          { status: res.status },
        )
      }
    },

    async ping(): Promise<boolean> {
      const res = await jsonFetch('/health', { method: 'GET' })
      return res.ok
    },
  }
}

function readStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`tangle-id: missing required argument "${key}"`)
  }
  return value
}

function readOptionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !value) return undefined
  return value
}

function readOptionalRole(
  args: Record<string, unknown>,
  key: string,
): TangleWorkspaceSummary['role'] | undefined {
  const value = args[key]
  if (value === 'owner' || value === 'admin' || value === 'member') return value
  return undefined
}
