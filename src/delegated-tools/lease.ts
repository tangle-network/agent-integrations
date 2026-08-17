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
  /** Product-owned check that this workspace may delegate these tools now. */
  ownerPolicy?: DelegatedToolOwnerPolicy
}

export interface DelegatedToolOwnerPolicy {
  authorize(input: {
    workspaceId: string
    allowedTools: readonly string[]
    operation: 'issue_lease'
  }): Promise<boolean> | boolean
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
  const workspaceId = input.workspaceId.trim()
  const allowedTools = input.allowedTools.filter((tool) => typeof tool === 'string' && tool.trim())
  if (!workspaceId || allowedTools.length === 0 || allowedTools.length !== input.allowedTools.length) return null
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0 || input.ttlSeconds > 3600) return null
  if (!input.ownerPolicy) return null
  if (!(await input.ownerPolicy.authorize({ workspaceId, allowedTools, operation: 'issue_lease' }))) return null
  const now = input.now ?? Date.now()
  const token = await mintDelegatedToolToken({
    workspaceId,
    allowedTools,
    ttlSeconds: input.ttlSeconds,
    secret: input.secret,
    prefix: input.prefix,
    now,
  })
  if (!token) return null
  return {
    token,
    allowedTools,
    expiresAt: now + input.ttlSeconds * 1000,
    callbackUrl: input.callbackUrl,
  }
}
