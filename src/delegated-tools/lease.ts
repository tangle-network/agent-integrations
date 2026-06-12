/**
 * Standardized lease payload the product hands to its external agent.
 *
 * The product resolves which tools a workspace may delegate right now, mints a
 * scoped token over exactly those names ({@link mintDelegatedToolToken}), and
 * packages the result as a lease. The external agent (or the broker that builds
 * its session) reads `callbackUrl` + `token` to reach the product's
 * {@link handleDelegatedToolRequest} endpoint mid-session.
 *
 * Standardizing the shape here means every caller's lease looks the same on the
 * wire regardless of the external runtime (voice broker, autonomous worker).
 */

import { mintDelegatedToolToken } from './token.js'

export interface IssueDelegatedToolLeaseInput {
  workspaceId: string
  allowedTools: string[]
  ttlSeconds: number
  /** Shared HMAC secret for the token. Absent ⇒ lease cannot be issued. */
  secret?: string
  /** Token prefix; forwarded to {@link mintDelegatedToolToken}. */
  prefix?: string
  /** Endpoint the external agent calls back into. Echoed onto the lease. */
  callbackUrl?: string
  /** Override the clock (epoch ms) — for tests. */
  now?: number
}

export interface DelegatedToolLease {
  token: string
  allowedTools: string[]
  /** Epoch milliseconds at which the lease (and its token) expires. */
  expiresAt: number
  callbackUrl?: string
}

/**
 * Issue a delegated-tool lease, or `null` when no secret is configured
 * (fail-closed — the product refuses to hand out an unauthenticated lease).
 * Pass an already-filtered `allowedTools`: this helper signs whatever it is
 * given, so the product MUST intersect against what the workspace can delegate
 * before calling.
 */
export async function issueDelegatedToolLease(
  input: IssueDelegatedToolLeaseInput,
): Promise<DelegatedToolLease | null> {
  const now = input.now ?? Date.now()
  const token = await mintDelegatedToolToken({
    workspaceId: input.workspaceId,
    allowedTools: input.allowedTools,
    ttlSeconds: input.ttlSeconds,
    secret: input.secret,
    prefix: input.prefix,
    now,
  })
  if (!token) return null
  return {
    token,
    allowedTools: input.allowedTools,
    expiresAt: now + input.ttlSeconds * 1000,
    callbackUrl: input.callbackUrl,
  }
}
