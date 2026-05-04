/**
 * Inbound webhook signature verifiers — provider-specific HMAC schemes.
 *
 * Each signature scheme is a pure function:
 *   (rawBody: string, headers, secret, now?) → boolean
 *
 * Constant-time comparison via `crypto.timingSafeEqual`. Timestamps are
 * checked against a configurable tolerance to bound replay risk; the default
 * mirrors the upstream provider's documented window (Stripe: 5 min, Slack: 5 min).
 *
 * These verifiers are the building blocks for any inbound-webhook receiver
 * (a route + a `verify` call + a per-event handler). They live in this
 * package so every consumer of the integration substrate gets correct
 * verification — not just one product reimplementing it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Default replay-protection window. Providers commonly use 5 minutes. */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 5 * 60

// ─── Stripe ─────────────────────────────────────────────────────────────
//
// Stripe signs webhooks with a single header `Stripe-Signature` of the form
//
//   t=<timestamp>,v1=<sig1>,v1=<sig2>,...
//
// where `t` is the Unix timestamp the event was generated, and each `v1`
// is `HMAC-SHA256(secret, "<t>.<rawBody>")`. Multiple `v1` entries appear
// during secret rotation — any one matching is sufficient.
//
// https://stripe.com/docs/webhooks/signatures

export interface ParsedStripeSignatureHeader {
  t: number
  sigs: string[]
}

export function parseStripeSignatureHeader(header: string): ParsedStripeSignatureHeader | null {
  const acc: { ts?: number; sigs: string[] } = { sigs: [] }
  for (const part of header.split(',')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim()
    if (key === 't') {
      const n = Number(val)
      if (Number.isFinite(n)) acc.ts = n
    } else if (key === 'v1') {
      acc.sigs.push(val)
    }
  }
  if (acc.ts === undefined || acc.sigs.length === 0) return null
  return { t: acc.ts, sigs: acc.sigs }
}

export interface StripeVerifyOptions {
  /** Replay-protection window in seconds. Default 300. */
  toleranceSeconds?: number
  /** Override `now()` for tests. UTC seconds. */
  now?: number
}

/** Verify a Stripe webhook signature against the raw request body. */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  options: StripeVerifyOptions = {},
): boolean {
  const parsed = parseStripeSignatureHeader(signatureHeader)
  if (!parsed) return false
  const tolerance = options.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS
  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - parsed.t) > tolerance) return false
  const expected = createHmac('sha256', secret).update(`${parsed.t}.${rawBody}`).digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  for (const sig of parsed.sigs) {
    const sigBuf = Buffer.from(sig, 'utf8')
    if (sigBuf.length !== expectedBuf.length) continue
    if (timingSafeEqual(sigBuf, expectedBuf)) return true
  }
  return false
}

// ─── Slack ──────────────────────────────────────────────────────────────
//
// Slack signs request bodies with two headers:
//
//   X-Slack-Signature:         v0=<HMAC-SHA256(secret, "v0:<ts>:<body>")>
//   X-Slack-Request-Timestamp: <ts>
//
// https://api.slack.com/authentication/verifying-requests-from-slack

export interface SlackVerifyOptions {
  toleranceSeconds?: number
  now?: number
}

export function verifySlackSignature(
  rawBody: string,
  signatureHeader: string,
  timestampHeader: string,
  secret: string,
  options: SlackVerifyOptions = {},
): boolean {
  if (!signatureHeader.startsWith('v0=')) return false
  const ts = Number(timestampHeader)
  if (!Number.isFinite(ts)) return false
  const tolerance = options.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS
  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > tolerance) return false
  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const sigBuf = Buffer.from(signatureHeader, 'utf8')
  if (sigBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(sigBuf, expectedBuf)
}

// ─── Generic HMAC ───────────────────────────────────────────────────────
//
// For "we shipped a webhook URL with a shared HMAC secret" patterns —
// covers any custom integration where the operator picks the message
// format. The signed message is the literal `rawBody` (no timestamp
// prefix); replay protection is the caller's responsibility (use a
// nonce header + a small dedup cache).

export interface GenericHmacVerifyOptions {
  /** sha256 (default) | sha1 | sha512 — matches the algorithm the receiver
   *  computed at sign time. */
  algorithm?: 'sha256' | 'sha1' | 'sha512'
  /** Optional prefix the receiver prepends to the signature in the header
   *  (e.g., `'sha256='`). Stripped before constant-time comparison. */
  signaturePrefix?: string
  /** Lowercase comparison (most providers emit hex-lowercase). Default true. */
  lowercaseHex?: boolean
}

export function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  options: GenericHmacVerifyOptions = {},
): boolean {
  const algorithm = options.algorithm ?? 'sha256'
  const prefix = options.signaturePrefix ?? ''
  const lower = options.lowercaseHex ?? true
  let candidate = signatureHeader
  if (prefix && candidate.startsWith(prefix)) candidate = candidate.slice(prefix.length)
  if (lower) candidate = candidate.toLowerCase()
  const expected = createHmac(algorithm, secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const sigBuf = Buffer.from(candidate, 'utf8')
  if (sigBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(sigBuf, expectedBuf)
}

// ─── Header helper ──────────────────────────────────────────────────────
//
// Most fastify/express adapters expose request headers as
// `Record<string, string | string[] | undefined>`. This helper picks the
// first canonical value for a given name (case-insensitive).

export function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(v)) return v[0]
  return typeof v === 'string' ? v : undefined
}
