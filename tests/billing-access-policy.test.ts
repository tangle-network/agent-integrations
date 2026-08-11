import { describe, expect, it } from 'vitest'
import {
  assertNoProductFreeTrial,
  decideBillingAccess,
  NO_PRODUCT_FREE_CREDITS_POLICY,
  parseTrustedPlatformEvidence,
  PRODUCT_FREE_CREDIT_SOURCES,
  type PlatformAccessEvidencePayload,
} from '../src/billing-access-policy'

function evidencePayload(
  overrides: Partial<PlatformAccessEvidencePayload> & {
    funding?: Record<string, unknown>
    principal?: Record<string, unknown>
  } = {},
): PlatformAccessEvidencePayload {
  return {
    policyVersion: 1,
    issuer: 'id.tangle.tools',
    evidenceId: 'evidence_1',
    issuedAt: '2026-08-10T12:00:00.000Z',
    emailVerified: true,
    user: { id: 'user_1', email: 'person@company.com' },
    principal: { kind: 'human' },
    funding: {
      kind: 'paid_purchase',
      id: 'purchase_1',
      amountUsd: 10,
      paidAt: '2026-08-10T11:59:00.000Z',
    },
    ...overrides,
  }
}

function evidence(overrides: Parameters<typeof evidencePayload>[0] = {}) {
  const parsed = parseTrustedPlatformEvidence(evidencePayload(overrides), { expectedUserId: 'user_1' })
  if (!parsed) throw new Error('test fixture did not parse')
  return parsed
}

describe('NO_PRODUCT_FREE_CREDITS_POLICY', () => {
  it('keeps every product-funded source disabled and requires Platform evidence', () => {
    expect(NO_PRODUCT_FREE_CREDITS_POLICY).toEqual({
      productFreeCredits: false,
      productFreeTrials: false,
      productPromotions: false,
      productFallbackCredits: false,
      productSyntheticCredits: false,
      humanEmailVerificationRequired: true,
      platformEvidenceRequired: true,
    })
    for (const source of PRODUCT_FREE_CREDIT_SOURCES) {
      expect(decideBillingAccess({})).toMatchObject({
        allowed: false,
        code: 'platform_evidence_required',
      })
      expect(source).toBeTruthy()
    }
  })

  it('rejects a caller claim even when it names a paid or free source', () => {
    expect(decideBillingAccess({ source: 'paid_purchase' } as never)).toMatchObject({
      allowed: false,
      code: 'platform_evidence_required',
    })
    expect(decideBillingAccess({ source: 'trial' } as never)).toMatchObject({
      allowed: false,
      code: 'platform_evidence_required',
    })
  })
})

describe('Platform evidence', () => {
  it.each([
    ['paid_purchase', { kind: 'paid_purchase', id: 'purchase_1', amountUsd: 10, paidAt: '2026-08-10T11:59:00.000Z' }],
    ['paid_subscription', { kind: 'paid_subscription', id: 'sub_evidence', subscriptionId: 'sub_1', status: 'active', amountUsd: 29 }],
    ['byok', { kind: 'byok', id: 'byok_1', provider: 'openai', keyId: 'key_1' }],
    ['named_service', { kind: 'named_service', id: 'service_1', serviceId: 'service:blueprint-agent', serviceName: 'blueprint-agent' }],
    ['admin', { kind: 'admin', id: 'admin_1', adminId: 'admin_user_1' }],
  ] as const)('allows trusted %s evidence', (_name, funding) => {
    const parsed = evidence({ funding })
    expect(decideBillingAccess({ evidence: parsed, expectedUserId: 'user_1' })).toMatchObject({
      allowed: true,
      basis: funding.kind,
    })
  })

  it('rejects a lookalike object copied from a trusted result', () => {
    const parsed = evidence()
    const lookalike = structuredClone(parsed)
    expect(decideBillingAccess({ evidence: lookalike })).toMatchObject({
      allowed: false,
      code: 'platform_evidence_required',
    })
  })

  it('rejects a different owner', () => {
    expect(decideBillingAccess({ evidence: evidence(), expectedUserId: 'user_2' })).toMatchObject({
      allowed: false,
      code: 'platform_evidence_subject_mismatch',
    })
  })

  it('rejects unverified, placeholder, and zero-dollar evidence', () => {
    expect(parseTrustedPlatformEvidence(evidencePayload({ emailVerified: false }))).toBeNull()
    expect(parseTrustedPlatformEvidence(evidencePayload({ user: { id: 'user_1', email: 'test@example.com' } }))).toBeNull()
    expect(parseTrustedPlatformEvidence(evidencePayload({ funding: { kind: 'paid_purchase', id: 'p', amountUsd: 0, paidAt: 'now' } }))).toBeNull()
    expect(parseTrustedPlatformEvidence(evidencePayload({ issuedAt: 'not-a-date' }))).toBeNull()
  })

  it('rejects missing or unknown principal types instead of defaulting to human', () => {
    expect(parseTrustedPlatformEvidence(evidencePayload({ principal: undefined }))).toBeNull()
    expect(parseTrustedPlatformEvidence(evidencePayload({ principal: { kind: 'unknown' } }))).toBeNull()
  })

  it('freezes parsed evidence so a caller cannot rewrite its funding basis', () => {
    const parsed = evidence()
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.principal)).toBe(true)
    expect(Object.isFrozen(parsed.funding)).toBe(true)
    expect(() => {
      ;(parsed.funding as { kind: string }).kind = 'admin'
    }).toThrow()
    expect(decideBillingAccess({ evidence: parsed }).allowed).toBe(true)
  })
})

describe('assertNoProductFreeTrial', () => {
  it('rejects positive, negative, and non-integer trial periods', () => {
    expect(() => assertNoProductFreeTrial(14)).toThrow(/product-funded free trials are disabled/)
    expect(() => assertNoProductFreeTrial(-1)).toThrow(/non-negative integer/)
    expect(() => assertNoProductFreeTrial(1.5)).toThrow(/non-negative integer/)
    expect(() => assertNoProductFreeTrial(undefined)).not.toThrow()
    expect(() => assertNoProductFreeTrial(0)).not.toThrow()
  })
})
