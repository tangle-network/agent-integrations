/**
 * Shared billing and identity policy for product integrations.
 *
 * Product code must not prove access by sending a string such as
 * `paid_purchase` or `byok`. The only accepted proof is an object parsed from
 * the Platform response by `parseTrustedPlatformEvidence`.
 */

export const PLATFORM_ACCESS_POLICY_VERSION = 1 as const
export const PLATFORM_ACCESS_ISSUER = 'id.tangle.tools' as const

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
  evidenceId: string
  principal: TrustedPlatformPrincipal
  funding: TrustedFundingEvidence
  /** Platform response time. Consumers may use this for short cache TTLs. */
  issuedAt: string
}

/** The wire shape returned by Platform's access/evidence endpoint. */
export interface PlatformAccessEvidencePayload {
  policyVersion?: unknown
  issuer?: unknown
  evidenceId?: unknown
  issuedAt?: unknown
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
 * as proof. Only the parser below can mark an object as Platform-issued. */
const trustedEvidenceObjects = new WeakSet<object>()

/**
 * Parse and mark an access response from Platform.
 *
 * `null` means the response is missing a required policy, identity, or funding
 * field. Products must deny access when parsing returns null.
 */
export function parseTrustedPlatformEvidence(
  payload: unknown,
  options: { expectedUserId?: string } = {},
): TrustedPlatformEvidence | null {
  if (!isRecord(payload)) return null
  if (payload.policyVersion !== PLATFORM_ACCESS_POLICY_VERSION) return null
  if (payload.issuer !== PLATFORM_ACCESS_ISSUER) return null

  const evidenceId = readNonEmptyString(payload.evidenceId)
  const issuedAt = readNonEmptyString(payload.issuedAt)
  const user = isRecord(payload.user) ? payload.user : undefined
  const principal = isRecord(payload.principal) ? payload.principal : undefined
  const funding = isRecord(payload.funding) ? payload.funding : undefined
  if (!evidenceId || !issuedAt || !Number.isFinite(Date.parse(issuedAt)) || !user || !principal || !funding) return null

  const userId = readNonEmptyString(user.id)
  if (!userId || (options.expectedUserId && userId !== options.expectedUserId)) return null

  const principalValue = parsePrincipal({ payload, user, principal, userId })
  const fundingValue = parseFunding(funding)
  if (!principalValue || !fundingValue) return null
  if (principalValue.kind === 'human' && payload.emailVerified !== true) return null

  const result: TrustedPlatformEvidence = Object.freeze({
    issuer: PLATFORM_ACCESS_ISSUER,
    policyVersion: PLATFORM_ACCESS_POLICY_VERSION,
    evidenceId,
    principal: Object.freeze(principalValue),
    funding: Object.freeze(fundingValue),
    issuedAt,
  })
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

/**
 * Shared email check for every product boundary. It intentionally rejects
 * test/example domains and common synthetic addresses. Platform remains the
 * authority for inbox verification; this prevents accidental local bypasses.
 */
export function isRealNonPlaceholderEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const email = value.trim().toLowerCase()
  if (email.length < 6 || email.length > 320 || /\s/.test(email)) return false
  const match = /^([^@]+)@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/.exec(email)
  if (!match) return false
  const local = match[1]!
  const domain = match[2]!
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false
  if (domain === 'localhost' || domain.endsWith('.test') || domain.endsWith('.invalid') || domain.endsWith('.example')) {
    return false
  }
  if (
    /(?:^|[.-])(test|example|placeholder|invalid|disposable|tempmail|mailinator|10minutemail|guerrillamail|yopmail)(?:[.-]|$)/.test(
      domain,
    )
  ) {
    return false
  }
  if (/^(test|tester|example|placeholder|no-?reply|noreply)(?:[+._-]|$)/.test(local)) return false
  if (/^0x[a-f0-9]{40}@tangle\.tools$/i.test(email)) return false
  if (email.endsWith('@users.noreply.tangle.tools')) return false
  return true
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
    return amountUsd !== null && paidAt ? { kind, evidenceId, amountUsd, paidAt } : null
  }
  if (kind === 'paid_subscription') {
    const subscriptionId = readNonEmptyString(value.subscriptionId)
    const status = value.status === 'active' || value.status === 'past_due' ? value.status : null
    const amountUsd = readPositiveNumber(value.amountUsd)
    if (!subscriptionId || !status || amountUsd === null) return null
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
