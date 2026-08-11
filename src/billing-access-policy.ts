import {
  jwtVerify,
  type CryptoKey as JoseCryptoKey,
  type JWK,
  type JWTPayload,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
  type KeyObject,
} from 'jose'
import {
  resolveAtomicIdempotencyStore,
  type AtomicIdempotencyStore,
  type IdempotencyRuntime,
} from './idempotency.js'

/**
 * Shared billing and identity policy for product integrations.
 *
 * Product code must not prove access by sending a string such as
 * `paid_purchase` or `byok`. The only accepted proof is an object parsed from
 * a signed Platform token verified by `verifyTrustedPlatformEvidence`.
 */

export const PLATFORM_ACCESS_POLICY_VERSION = 1 as const
export const PLATFORM_ACCESS_ISSUER = 'id.tangle.tools' as const
/**
 * Keep a paid-purchase record consumed for the practical lifetime of the
 * product. A backend that cannot retain this TTL must fail the claim instead
 * of shortening it, because a shortened TTL can issue the same purchase twice.
 */
export const PLATFORM_FUNDING_REPLAY_RETENTION_MS = 100 * 365 * 24 * 60 * 60 * 1000

export const PRODUCT_FREE_CREDIT_SOURCES = Object.freeze([
  'signup',
  'trial',
  'promo',
  'fallback',
  'synthetic',
] as const)

export type ProductFreeCreditSource = (typeof PRODUCT_FREE_CREDIT_SOURCES)[number]

export type TrustedFundingEvidence =
  | {
      kind: 'paid_purchase'
      evidenceId: string
      amountUsd: number
      paidAt: string
    }
  | {
      kind: 'paid_subscription'
      evidenceId: string
      subscriptionId: string
      status: 'active' | 'past_due'
      amountUsd: number
      currentPeriodEnd?: string | null
    }
  | {
      kind: 'byok'
      evidenceId: string
      provider: string
      keyId: string
    }
  | {
      kind: 'named_service'
      evidenceId: string
      serviceId: string
      serviceName: string
    }
  | {
      kind: 'admin'
      evidenceId: string
      adminId: string
    }

export type TrustedPlatformPrincipal =
  | {
      kind: 'human'
      userId: string
      email: string
      emailVerified: true
    }
  | {
      kind: 'service_principal'
      userId: string
      serviceId: string
      serviceName: string
    }
  | {
      kind: 'admin'
      userId: string
      adminId: string
    }

export interface TrustedPlatformEvidence {
  issuer: typeof PLATFORM_ACCESS_ISSUER
  policyVersion: typeof PLATFORM_ACCESS_POLICY_VERSION
  /** Immutable Platform funding-record id. Purchases use it for replay protection. */
  evidenceId: string
  /** One-time JWT id used to audit the signed presentation. */
  tokenId: string
  principal: TrustedPlatformPrincipal
  funding: TrustedFundingEvidence
  /** Product identifier the Platform signature binds this proof to. */
  audience: string
  /** Platform signing time. Consumers may use this for short cache TTLs. */
  issuedAt: string
  /** Hard token expiry from the signed JWT. */
  expiresAt: string
}

/** Custom claims inside Platform's signed access-evidence JWT. */
export interface PlatformAccessEvidencePayload {
  policyVersion?: unknown
  emailVerified?: unknown
  user?: { id?: unknown; email?: unknown }
  principal?: {
    kind?: unknown
    id?: unknown
    name?: unknown
  }
  funding?: {
    kind?: unknown
    id?: unknown
    amountUsd?: unknown
    paidAt?: unknown
    subscriptionId?: unknown
    status?: unknown
    currentPeriodEnd?: unknown
    provider?: unknown
    keyId?: unknown
    serviceId?: unknown
    serviceName?: unknown
    adminId?: unknown
  }
}

export type PlatformEvidenceVerificationKey =
  | JoseCryptoKey
  | KeyObject
  | JWK
  | Uint8Array
  | JWTVerifyGetKey

export interface VerifyTrustedPlatformEvidenceOptions {
  /** Exact product/service audience expected by this consumer. */
  audience: string
  /** Exact owner id expected by this request. */
  expectedUserId: string
  /** Platform public key or trusted JWKS resolver. Never use a shared HMAC key. */
  verificationKey: PlatformEvidenceVerificationKey
  /** Shared atomic store for purchase and signed-presentation replay claims. */
  replayStore: AtomicIdempotencyStore
  /** Production requires a shared replay store. */
  runtime?: IdempotencyRuntime
  /** Test clock override. */
  now?(): number
  /** Allowed clock skew in seconds. Default 5. */
  clockToleranceSeconds?: number
  /** Maximum age from `iat` in seconds. Default 300. */
  maxTokenAgeSeconds?: number
}

export type BillingAccessDecision =
  | {
      allowed: true
      basis: TrustedFundingEvidence['kind']
      principal: TrustedPlatformPrincipal
    }
  | {
      allowed: false
      code:
        | 'product_free_credits_disabled'
        | 'email_verification_required'
        | 'real_email_required'
        | 'platform_evidence_required'
        | 'platform_evidence_expired'
        | 'platform_evidence_replayed'
        | 'platform_evidence_subject_mismatch'
        | 'paid_evidence_required'
      reason: string
    }

/** Public policy values make accidental re-enablement visible in reviews. */
export const NO_PRODUCT_FREE_CREDITS_POLICY = Object.freeze({
  productFreeCredits: false,
  productFreeTrials: false,
  productPromotions: false,
  productFallbackCredits: false,
  productSyntheticCredits: false,
  humanEmailVerificationRequired: true,
  platformEvidenceRequired: true,
})

/* WeakSet prevents a caller from constructing a lookalike object and passing it
 * as proof. Only successful signature verification can mark an object trusted. */
const trustedEvidenceObjects = new WeakSet<object>()
const consumedPurchaseEvidenceObjects = new WeakSet<object>()

/**
 * Verify and consume one signed access proof from Platform.
 *
 * Standard JWT claims bind issuer, audience, subject, issue time, not-before,
 * expiry, and one-time id. Custom claims bind the principal to the funding
 * record. Invalid or replayed tokens return null. Replay-store failures throw,
 * so callers return a non-success response instead of granting access.
 */
export async function verifyTrustedPlatformEvidence(
  signedEvidence: string,
  options: VerifyTrustedPlatformEvidenceOptions,
): Promise<TrustedPlatformEvidence | null> {
  if (typeof signedEvidence !== 'string' || !signedEvidence.trim()) return null
  if (!options.audience.trim() || !options.expectedUserId.trim()) return null
  const nowMs = (options.now ?? Date.now)()
  if (!Number.isFinite(nowMs)) return null
  const clockToleranceSeconds = options.clockToleranceSeconds ?? 5
  const maxTokenAgeSeconds = options.maxTokenAgeSeconds ?? 300
  if (!Number.isFinite(clockToleranceSeconds) || clockToleranceSeconds < 0) return null
  if (!Number.isFinite(maxTokenAgeSeconds) || maxTokenAgeSeconds <= 0) return null

  let verified: { payload: JWTPayload }
  try {
    const verifyOptions: JWTVerifyOptions = {
      algorithms: ['ES256', 'ES384', 'EdDSA', 'PS256', 'PS384', 'RS256', 'RS384'],
      issuer: PLATFORM_ACCESS_ISSUER,
      audience: options.audience,
      subject: options.expectedUserId,
      requiredClaims: ['iss', 'aud', 'sub', 'iat', 'nbf', 'exp', 'jti'],
      currentDate: new Date(nowMs),
      clockTolerance: clockToleranceSeconds,
      maxTokenAge: maxTokenAgeSeconds,
    }
    if (typeof options.verificationKey === 'function') {
      verified = await jwtVerify(signedEvidence, options.verificationKey, verifyOptions)
    } else {
      verified = await jwtVerify(signedEvidence, options.verificationKey, verifyOptions)
    }
  } catch {
    return null
  }

  const payload = verified.payload
  const nowSeconds = Math.floor(nowMs / 1000)
  if (
    payload.aud !== options.audience
    || payload.sub !== options.expectedUserId
    || typeof payload.iat !== 'number'
    || typeof payload.nbf !== 'number'
    || typeof payload.exp !== 'number'
    || typeof payload.jti !== 'string'
    || !payload.jti.trim()
    || payload.iat > nowSeconds
    || payload.nbf > nowSeconds
    || payload.exp <= nowSeconds
  ) return null
  if (!isRecord(payload)) return null
  if (payload.policyVersion !== PLATFORM_ACCESS_POLICY_VERSION) return null
  const user = isRecord(payload.user) ? payload.user : undefined
  const principal = isRecord(payload.principal) ? payload.principal : undefined
  const funding = isRecord(payload.funding) ? payload.funding : undefined
  if (!user || !principal || !funding) return null

  const userId = readNonEmptyString(user.id)
  if (!userId || userId !== options.expectedUserId || payload.sub !== userId) return null

  const principalValue = parsePrincipal({ payload, user, principal, userId })
  const fundingValue = parseFunding(funding)
  if (!principalValue || !fundingValue) return null
  if (principalValue.kind === 'human' && payload.emailVerified !== true) return null
  if (!principalMatchesFunding(principalValue, fundingValue)) return null

  const replayStore = resolveAtomicIdempotencyStore({
    component: 'verifyTrustedPlatformEvidence',
    store: options.replayStore,
    runtime: options.runtime,
  })
  const tokenTtlMs = Math.max(1, Math.ceil((payload.exp - nowSeconds + clockToleranceSeconds) * 1000))
  const oneTimePurchase = fundingValue.kind === 'paid_purchase'
  const replayKey = [
    'platform-access',
    PLATFORM_ACCESS_ISSUER,
    PLATFORM_ACCESS_POLICY_VERSION,
    oneTimePurchase ? 'funding' : 'presentation',
    oneTimePurchase ? fundingValue.evidenceId : payload.jti,
  ].join(':')
  const replayTtlMs = oneTimePurchase
    ? Math.max(PLATFORM_FUNDING_REPLAY_RETENTION_MS, tokenTtlMs)
    : tokenTtlMs
  if (!(await replayStore.claim(replayKey, replayTtlMs))) return null

  const result: TrustedPlatformEvidence = Object.freeze({
    issuer: PLATFORM_ACCESS_ISSUER,
    policyVersion: PLATFORM_ACCESS_POLICY_VERSION,
    evidenceId: fundingValue.evidenceId,
    tokenId: payload.jti,
    principal: Object.freeze(principalValue),
    funding: Object.freeze(fundingValue),
    audience: options.audience,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  })
  try {
    await replayStore.complete(replayKey)
  } catch (completeError) {
    try {
      await replayStore.release(replayKey)
    } catch (releaseError) {
      throw new AggregateError(
        [completeError, releaseError],
        'Platform evidence claim could not complete or release',
      )
    }
    throw completeError
  }
  trustedEvidenceObjects.add(result)
  return result
}

export function isTrustedPlatformEvidence(value: unknown): value is TrustedPlatformEvidence {
  return isRecord(value) && trustedEvidenceObjects.has(value)
}

export function decideBillingAccess(input: {
  evidence?: TrustedPlatformEvidence
  expectedUserId?: string
}): BillingAccessDecision {
  const evidence = input.evidence
  if (!evidence || !isTrustedPlatformEvidence(evidence)) {
    return {
      allowed: false,
      code: 'platform_evidence_required',
      reason: 'Platform must attest the identity and funding source',
    }
  }
  const expiresAt = Date.parse(evidence.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return {
      allowed: false,
      code: 'platform_evidence_expired',
      reason: 'Platform evidence has expired',
    }
  }
  if (input.expectedUserId && evidence.principal.userId !== input.expectedUserId) {
    return {
      allowed: false,
      code: 'platform_evidence_subject_mismatch',
      reason: 'Platform evidence belongs to a different owner',
    }
  }
  if (evidence.principal.kind === 'human') {
    if (evidence.principal.emailVerified !== true) {
      return {
        allowed: false,
        code: 'email_verification_required',
        reason: 'Human access requires a verified email',
      }
    }
    if (!isRealNonPlaceholderEmail(evidence.principal.email)) {
      return {
        allowed: false,
        code: 'real_email_required',
        reason: 'Human access requires a real non-placeholder email',
      }
    }
  }
  if (evidence.funding.kind === 'paid_purchase') {
    if (consumedPurchaseEvidenceObjects.has(evidence)) {
      return {
        allowed: false,
        code: 'platform_evidence_replayed',
        reason: 'Paid purchase evidence was already consumed',
      }
    }
    consumedPurchaseEvidenceObjects.add(evidence)
  }
  return { allowed: true, basis: evidence.funding.kind, principal: evidence.principal }
}

/** Reject positive trial periods before a checkout request reaches Stripe. */
export function assertNoProductFreeTrial(trialDays: number | undefined): void {
  if (trialDays === undefined || trialDays === 0) return
  if (!Number.isInteger(trialDays) || trialDays < 0) {
    throw new Error('billing: trialDays must be a non-negative integer')
  }
  throw new Error('billing: product-funded free trials are disabled')
}

const PLATFORM_EMAIL_PATTERN =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/
const PLATFORM_PLACEHOLDER_EMAIL_PATTERN =
  /(?:@users\.noreply\.tangle\.tools$|^0x[a-f0-9]{40}@tangle\.tools$)/i

/** Mirror Platform's shared `platformRealEmailSchema` until its package is published. */
export function isRealNonPlaceholderEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const email = value.trim()
  return email.length >= 3
    && email.length <= 320
    && PLATFORM_EMAIL_PATTERN.test(email)
    && !PLATFORM_PLACEHOLDER_EMAIL_PATTERN.test(email)
}

function parsePrincipal(input: {
  payload: Record<string, unknown>
  user: Record<string, unknown>
  principal: Record<string, unknown>
  userId: string
}): TrustedPlatformPrincipal | null {
  const kind = readNonEmptyString(input.principal.kind)
  if (kind === 'human') {
    const email = readNonEmptyString(input.user.email)
    return email && input.payload.emailVerified === true && isRealNonPlaceholderEmail(email)
      ? { kind, userId: input.userId, email, emailVerified: true }
      : null
  }
  if (kind === 'service_principal') {
    const serviceId = readNonEmptyString(input.principal.id)
    const serviceName = readNonEmptyString(input.principal.name)
    return serviceId && serviceName
      ? { kind, userId: input.userId, serviceId, serviceName }
      : null
  }
  if (kind === 'admin') {
    const adminId = readNonEmptyString(input.principal.id)
    return adminId ? { kind, userId: input.userId, adminId } : null
  }
  return null
}

function parseFunding(value: Record<string, unknown>): TrustedFundingEvidence | null {
  const kind = readNonEmptyString(value.kind)
  const evidenceId = readNonEmptyString(value.id)
  if (!kind || !evidenceId) return null
  if (kind === 'paid_purchase') {
    const amountUsd = readPositiveNumber(value.amountUsd)
    const paidAt = readNonEmptyString(value.paidAt)
    return amountUsd !== null && paidAt && Number.isFinite(Date.parse(paidAt))
      ? { kind, evidenceId, amountUsd, paidAt }
      : null
  }
  if (kind === 'paid_subscription') {
    const subscriptionId = readNonEmptyString(value.subscriptionId)
    const status = value.status === 'active' || value.status === 'past_due' ? value.status : null
    const amountUsd = readPositiveNumber(value.amountUsd)
    if (!subscriptionId || !status || amountUsd === null) return null
    if (
      value.currentPeriodEnd !== undefined
      && value.currentPeriodEnd !== null
      && (typeof value.currentPeriodEnd !== 'string' || !Number.isFinite(Date.parse(value.currentPeriodEnd)))
    ) return null
    return {
      kind,
      evidenceId,
      subscriptionId,
      status,
      amountUsd,
      ...(value.currentPeriodEnd === null || typeof value.currentPeriodEnd === 'string'
        ? { currentPeriodEnd: value.currentPeriodEnd }
        : {}),
    }
  }
  if (kind === 'byok') {
    const provider = readNonEmptyString(value.provider)
    const keyId = readNonEmptyString(value.keyId)
    return provider && keyId ? { kind, evidenceId, provider, keyId } : null
  }
  if (kind === 'named_service') {
    const serviceId = readNonEmptyString(value.serviceId)
    const serviceName = readNonEmptyString(value.serviceName)
    return serviceId && serviceName ? { kind, evidenceId, serviceId, serviceName } : null
  }
  if (kind === 'admin') {
    const adminId = readNonEmptyString(value.adminId)
    return adminId ? { kind, evidenceId, adminId } : null
  }
  return null
}

function principalMatchesFunding(
  principal: TrustedPlatformPrincipal,
  funding: TrustedFundingEvidence,
): boolean {
  if (principal.kind === 'human') {
    return funding.kind === 'paid_purchase'
      || funding.kind === 'paid_subscription'
      || funding.kind === 'byok'
  }
  if (principal.kind === 'service_principal') {
    return funding.kind === 'named_service'
      && funding.serviceId === principal.serviceId
      && funding.serviceName === principal.serviceName
  }
  return funding.kind === 'admin' && funding.adminId === principal.adminId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
