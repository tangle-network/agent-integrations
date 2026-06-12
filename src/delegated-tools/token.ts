/**
 * Short-lived, workspace-scoped bearer for the delegated-tool bridge.
 *
 * An external stateful agent — a voice caller, a long-running autonomous worker
 * — is handed one of these tokens and calls BACK into the product's tools
 * mid-session. The token names exactly which workspace and which tool names the
 * external agent may reach, and it EXPIRES, so a leaked lease stops working once
 * the session window closes. The product's connector credentials never leave the
 * product; the external agent only ever holds this opaque token and reaches the
 * product's callback endpoint (see {@link handleDelegatedToolCall}).
 *
 * This is a SIGNED-CLAIMS envelope, distinct from an identity capability token
 * (`HMAC(secret, "user:<id>")`, verified against a known id). Here the verifier
 * RECOVERS the claims (workspaceId, allowedTools, expiresAt) from the token
 * itself, so the bridge endpoint needs no prior knowledge of the lease.
 *
 * Crypto: WebCrypto HMAC-SHA256, base64url, constant-time compare. Runs on
 * Cloudflare Workers, Node, and the browser with no Node `crypto` dependency —
 * matching the sibling capability-token primitive. Fail-closed: with no secret,
 * mint returns `undefined` and verify returns `null`, so the bridge is simply
 * absent rather than silently unauthenticated.
 */

const DEFAULT_PREFIX = 'dtt_'

export interface DelegatedToolClaims {
  workspaceId: string
  allowedTools: string[]
  /** Epoch milliseconds at which the token stops verifying. */
  expiresAt: number
}

export interface MintDelegatedToolTokenInput {
  workspaceId: string
  allowedTools: string[]
  ttlSeconds: number
  /** Shared HMAC secret. When absent, mint returns `undefined` (fail-closed). */
  secret?: string
  /** Token prefix (namespaces the credential; lets verify reject foreign tokens
   *  cheaply). Default `dtt_`. */
  prefix?: string
  /** Override the clock (epoch ms) — for tests. Defaults to `Date.now()`. */
  now?: number
}

export interface VerifyDelegatedToolTokenOptions {
  secret?: string
  prefix?: string
  now?: number
}

function base64urlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecodeToString(input: string): string | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

async function sign(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return base64urlEncode(new Uint8Array(sig))
}

/** Length-independent-leak-free compare for two same-charset strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Mint a delegated-tool token carrying signed claims, or `undefined` when no
 * secret is configured (fail-closed — the caller refuses to issue a lease rather
 * than hand out an unauthenticated one).
 */
export async function mintDelegatedToolToken(input: MintDelegatedToolTokenInput): Promise<string | undefined> {
  const secret = input.secret?.trim()
  if (!secret) return undefined
  const prefix = input.prefix ?? DEFAULT_PREFIX
  const now = input.now ?? Date.now()
  const claims: DelegatedToolClaims = {
    workspaceId: input.workspaceId,
    allowedTools: input.allowedTools,
    expiresAt: now + input.ttlSeconds * 1000,
  }
  const payload = base64urlEncode(JSON.stringify(claims))
  const signature = await sign(payload, secret)
  return `${prefix}${payload}.${signature}`
}

/**
 * Verify a delegated-tool token and recover its claims. Returns `null` (never
 * throws) for an unconfigured secret, a wrong prefix, a malformed or forged
 * token, or an expired one.
 */
export async function verifyDelegatedToolToken(
  token: string,
  opts: VerifyDelegatedToolTokenOptions,
): Promise<DelegatedToolClaims | null> {
  const secret = opts.secret?.trim()
  const prefix = opts.prefix ?? DEFAULT_PREFIX
  if (!secret || !token.startsWith(prefix)) return null
  const body = token.slice(prefix.length)
  const dot = body.indexOf('.')
  if (dot <= 0) return null
  const payload = body.slice(0, dot)
  const signature = body.slice(dot + 1)
  if (!payload || !signature) return null

  const expected = await sign(payload, secret)
  if (!timingSafeEqual(signature, expected)) return null

  const json = base64urlDecodeToString(payload)
  if (json === null) return null

  let claims: unknown
  try {
    claims = JSON.parse(json)
  } catch {
    return null
  }
  if (!claims || typeof claims !== 'object') return null
  const record = claims as Record<string, unknown>
  if (typeof record.workspaceId !== 'string' || !record.workspaceId) return null
  if (typeof record.expiresAt !== 'number' || !Number.isFinite(record.expiresAt)) return null
  if (!Array.isArray(record.allowedTools) || !record.allowedTools.every((tool) => typeof tool === 'string')) return null

  const now = opts.now ?? Date.now()
  if (record.expiresAt <= now) return null

  return {
    workspaceId: record.workspaceId,
    allowedTools: record.allowedTools as string[],
    expiresAt: record.expiresAt,
  }
}
