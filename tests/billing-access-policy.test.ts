import { generateKeyPair, SignJWT, type CryptoKey } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  assertNoProductFreeTrial,
  decideBillingAccess,
  NO_PRODUCT_FREE_CREDITS_POLICY,
  PLATFORM_FUNDING_REPLAY_RETENTION_MS,
  PRODUCT_FREE_CREDIT_SOURCES,
  verifyTrustedPlatformEvidence,
  type PlatformAccessEvidencePayload,
} from '../src/billing-access-policy'
import { InMemoryAtomicIdempotencyStore } from '../src/idempotency'

const NOW_MS = Date.now()
const NOW_SECONDS = Math.floor(NOW_MS / 1000)
const AUDIENCE = 'legal-agent'

let privateKey: CryptoKey
let publicKey: CryptoKey
let otherPrivateKey: CryptoKey
let evidenceSequence = 0

beforeAll(async () => {
  const platformKeys = await generateKeyPair('ES256')
  const otherKeys = await generateKeyPair('ES256')
  privateKey = platformKeys.privateKey
  publicKey = platformKeys.publicKey
  otherPrivateKey = otherKeys.privateKey
})

function evidencePayload(
  overrides: Partial<PlatformAccessEvidencePayload> & {
    funding?: Record<string, unknown>
    principal?: Record<string, unknown>
  } = {},
): PlatformAccessEvidencePayload {
  return {
    policyVersion: 1,
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

async function signedEvidence(input: {
  payload?: PlatformAccessEvidencePayload
  issuer?: string
  audience?: string
  subject?: string
  issuedAt?: number
  notBefore?: number
  expiresAt?: number
  jwtId?: string
  signingKey?: CryptoKey
} = {}): Promise<string> {
  return new SignJWT((input.payload ?? evidencePayload()) as Record<string, unknown>)
    .setProtectedHeader({ alg: 'ES256', kid: 'platform-2026-08' })
    .setIssuer(input.issuer ?? 'id.tangle.tools')
    .setAudience(input.audience ?? AUDIENCE)
    .setSubject(input.subject ?? 'user_1')
    .setIssuedAt(input.issuedAt ?? NOW_SECONDS)
    .setNotBefore(input.notBefore ?? NOW_SECONDS - 1)
    .setExpirationTime(input.expiresAt ?? NOW_SECONDS + 300)
    .setJti(input.jwtId ?? `evidence_${++evidenceSequence}`)
    .sign(input.signingKey ?? privateKey)
}

async function verifyEvidence(
  token: string,
  overrides: Partial<Parameters<typeof verifyTrustedPlatformEvidence>[1]> = {},
) {
  return verifyTrustedPlatformEvidence(token, {
    audience: AUDIENCE,
    expectedUserId: 'user_1',
    verificationKey: publicKey,
    replayStore: new InMemoryAtomicIdempotencyStore(),
    runtime: 'test',
    now: () => NOW_MS,
    ...overrides,
  })
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

describe('signed Platform evidence', () => {
  it.each([
    ['paid_purchase', evidencePayload()],
    ['paid_subscription', evidencePayload({
      funding: {
        kind: 'paid_subscription',
        id: 'sub_evidence',
        subscriptionId: 'sub_1',
        status: 'active',
        amountUsd: 29,
      },
    })],
    ['byok', evidencePayload({
      funding: { kind: 'byok', id: 'byok_1', provider: 'openai', keyId: 'key_1' },
    })],
    ['named_service', evidencePayload({
      emailVerified: undefined,
      user: { id: 'service-user' },
      principal: { kind: 'service_principal', id: 'service:blueprint-agent', name: 'blueprint-agent' },
      funding: {
        kind: 'named_service',
        id: 'service_1',
        serviceId: 'service:blueprint-agent',
        serviceName: 'blueprint-agent',
      },
    })],
    ['admin', evidencePayload({
      emailVerified: undefined,
      user: { id: 'admin_user_1' },
      principal: { kind: 'admin', id: 'admin_user_1' },
      funding: { kind: 'admin', id: 'admin_1', adminId: 'admin_user_1' },
    })],
  ] as const)('allows cryptographically verified %s evidence', async (basis, payload) => {
    const subject = basis === 'named_service' ? 'service-user' : basis === 'admin' ? 'admin_user_1' : 'user_1'
    const token = await signedEvidence({ payload, subject })
    const parsed = await verifyEvidence(token, { expectedUserId: subject })
    expect(parsed).not.toBeNull()
    expect(decideBillingAccess({ evidence: parsed ?? undefined, expectedUserId: subject })).toMatchObject({
      allowed: true,
      basis,
    })
  })

  it('rejects unsigned JSON and a token signed by an untrusted key', async () => {
    await expect(verifyEvidence(JSON.stringify(evidencePayload()))).resolves.toBeNull()
    await expect(verifyEvidence(await signedEvidence({ signingKey: otherPrivateKey }))).resolves.toBeNull()
  })

  it('fails closed for wrong issuer, audience, subject, expiry, and future timestamps', async () => {
    const tokens = [
      await signedEvidence({ issuer: 'attacker.example' }),
      await signedEvidence({ audience: 'tax-agent' }),
      await signedEvidence({ subject: 'user_2' }),
      await signedEvidence({ expiresAt: NOW_SECONDS - 1 }),
      await signedEvidence({ notBefore: NOW_SECONDS + 60 }),
      await signedEvidence({ issuedAt: NOW_SECONDS + 60, notBefore: NOW_SECONDS - 1 }),
    ]
    for (const token of tokens) {
      await expect(verifyEvidence(token)).resolves.toBeNull()
    }
  })

  it('claims the signed funding record once and rejects token replay', async () => {
    const replayStore = new InMemoryAtomicIdempotencyStore()
    const token = await signedEvidence({ jwtId: 'one-time-evidence' })
    const options = { replayStore }
    await expect(verifyEvidence(token, options)).resolves.not.toBeNull()
    await expect(verifyEvidence(token, options)).resolves.toBeNull()
  })

  it('rejects a previously verified object after its signed expiry', async () => {
    const parsed = await verifyEvidence(await signedEvidence({ expiresAt: NOW_SECONDS + 1 }))
    if (!parsed) throw new Error('test fixture did not verify')
    const now = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS + 2_000)
    try {
      expect(decideBillingAccess({ evidence: parsed })).toMatchObject({
        allowed: false,
        code: 'platform_evidence_expired',
      })
    } finally {
      now.mockRestore()
    }
  })

  it('consumes a verified paid purchase object once', async () => {
    const parsed = await verifyEvidence(await signedEvidence())
    if (!parsed) throw new Error('test fixture did not verify')
    expect(decideBillingAccess({ evidence: parsed })).toMatchObject({
      allowed: true,
      basis: 'paid_purchase',
    })
    expect(decideBillingAccess({ evidence: parsed })).toMatchObject({
      allowed: false,
      code: 'platform_evidence_replayed',
    })
  })

  it('allows one verifier to consume signed funding under simultaneous requests', async () => {
    const replayStore = new InMemoryAtomicIdempotencyStore()
    const token = await signedEvidence({ jwtId: 'simultaneous-evidence' })
    const results = await Promise.all(Array.from({ length: 100 }, () => verifyEvidence(token, { replayStore })))
    expect(results.filter((result) => result !== null)).toHaveLength(1)
    expect(results.filter((result) => result === null)).toHaveLength(99)
  })

  it('rejects the same funding record when Platform re-signs it with a new jti', async () => {
    const replayStore = new InMemoryAtomicIdempotencyStore()
    const first = await signedEvidence({ jwtId: 'presentation_1' })
    const second = await signedEvidence({ jwtId: 'presentation_2' })
    await expect(verifyEvidence(first, { replayStore })).resolves.toMatchObject({
      evidenceId: 'purchase_1',
      tokenId: 'presentation_1',
    })
    await expect(verifyEvidence(second, { replayStore })).resolves.toBeNull()
  })

  it('rejects the same paid purchase across product audiences', async () => {
    const replayStore = new InMemoryAtomicIdempotencyStore()
    const legalToken = await signedEvidence({ audience: 'legal-agent', jwtId: 'legal-presentation' })
    const taxToken = await signedEvidence({
      audience: 'tax-agent',
      jwtId: 'tax-presentation',
    })

    await expect(verifyEvidence(legalToken, { audience: 'legal-agent', replayStore }))
      .resolves.not.toBeNull()
    await expect(verifyEvidence(taxToken, { audience: 'tax-agent', replayStore }))
      .resolves.toBeNull()
  })

  it('rejects a replayed continuing presentation but accepts a refreshed token', async () => {
    const replayStore = new InMemoryAtomicIdempotencyStore()
    const payload = evidencePayload({
      funding: {
        kind: 'paid_subscription',
        id: 'subscription-funding-1',
        subscriptionId: 'sub_1',
        status: 'active',
        amountUsd: 29,
      },
    })
    const first = await signedEvidence({ payload, jwtId: 'subscription-presentation-1' })
    const refreshed = await signedEvidence({ payload, jwtId: 'subscription-presentation-2' })

    await expect(verifyEvidence(first, { replayStore })).resolves.not.toBeNull()
    await expect(verifyEvidence(first, { replayStore })).resolves.toBeNull()
    await expect(verifyEvidence(refreshed, { replayStore })).resolves.not.toBeNull()
  })

  it('retains a consumed funding record beyond the short-lived JWT', async () => {
    const inner = new InMemoryAtomicIdempotencyStore()
    let claimedTtlMs = 0
    const replayStore = {
      scope: 'shared' as const,
      claim: (key: string, ttlMs: number) => {
        claimedTtlMs = ttlMs
        return inner.claim(key, ttlMs)
      },
      claimStatus: (key: string, ttlMs: number) => inner.claimStatus(key, ttlMs),
      release: (key: string) => inner.release(key),
      complete: (key: string) => inner.complete(key),
    }
    await expect(verifyEvidence(await signedEvidence(), { replayStore })).resolves.not.toBeNull()
    expect(claimedTtlMs).toBe(PLATFORM_FUNDING_REPLAY_RETENTION_MS)
    expect(claimedTtlMs).toBeGreaterThan(300_000)
  })

  it('retains a continuing presentation only through its signed lifetime', async () => {
    const inner = new InMemoryAtomicIdempotencyStore()
    let claimedTtlMs = 0
    const replayStore = {
      scope: 'shared' as const,
      claim: (key: string, ttlMs: number) => {
        claimedTtlMs = ttlMs
        return inner.claim(key, ttlMs)
      },
      claimStatus: (key: string, ttlMs: number) => inner.claimStatus(key, ttlMs),
      release: (key: string) => inner.release(key),
      complete: (key: string) => inner.complete(key),
    }
    const token = await signedEvidence({
      payload: evidencePayload({
        funding: {
          kind: 'paid_subscription',
          id: 'subscription-funding-ttl',
          subscriptionId: 'sub_1',
          status: 'active',
          amountUsd: 29,
        },
      }),
      jwtId: 'subscription-presentation-ttl',
    })

    await expect(verifyEvidence(token, { replayStore })).resolves.not.toBeNull()
    expect(claimedTtlMs).toBe(305_000)
  })

  it('releases a claim when durable completion fails so verification can retry', async () => {
    const inner = new InMemoryAtomicIdempotencyStore()
    let failCompletion = true
    let releases = 0
    const replayStore = {
      scope: 'shared' as const,
      claim: (key: string, ttlMs: number) => inner.claim(key, ttlMs),
      claimStatus: (key: string, ttlMs: number) => inner.claimStatus(key, ttlMs),
      release: (key: string) => {
        releases++
        inner.release(key)
      },
      complete: (key: string) => {
        if (failCompletion) {
          failCompletion = false
          throw new Error('completion unavailable')
        }
        inner.complete(key)
      },
    }
    const token = await signedEvidence({ jwtId: 'completion-retry' })

    await expect(verifyEvidence(token, { replayStore })).rejects.toThrow('completion unavailable')
    await expect(verifyEvidence(token, { replayStore })).resolves.not.toBeNull()
    expect(releases).toBe(1)
  })

  it('rejects a multi-audience token instead of treating a broad audience as exact', async () => {
    const token = await new SignJWT(evidencePayload() as Record<string, unknown>)
      .setProtectedHeader({ alg: 'ES256', kid: 'platform-2026-08' })
      .setIssuer('id.tangle.tools')
      .setAudience([AUDIENCE, 'tax-agent'])
      .setSubject('user_1')
      .setIssuedAt(NOW_SECONDS)
      .setNotBefore(NOW_SECONDS - 1)
      .setExpirationTime(NOW_SECONDS + 300)
      .setJti('broad-audience')
      .sign(privateKey)
    await expect(verifyEvidence(token)).resolves.toBeNull()
  })

  it('rejects mismatched service and admin principals even when the token is signed', async () => {
    const serviceToken = await signedEvidence({
      subject: 'service-user',
      payload: evidencePayload({
        emailVerified: undefined,
        user: { id: 'service-user' },
        principal: { kind: 'service_principal', id: 'service:blueprint-agent', name: 'blueprint-agent' },
        funding: {
          kind: 'named_service',
          id: 'service-funding',
          serviceId: 'service:tax-agent',
          serviceName: 'tax-agent',
        },
      }),
    })
    const adminToken = await signedEvidence({
      subject: 'admin_user_1',
      payload: evidencePayload({
        emailVerified: undefined,
        user: { id: 'admin_user_1' },
        principal: { kind: 'admin', id: 'admin_user_1' },
        funding: { kind: 'admin', id: 'admin-funding', adminId: 'admin_user_2' },
      }),
    })
    await expect(verifyEvidence(serviceToken, { expectedUserId: 'service-user' })).resolves.toBeNull()
    await expect(verifyEvidence(adminToken, { expectedUserId: 'admin_user_1' })).resolves.toBeNull()
  })

  it('rejects unverified, Platform-placeholder, and zero-dollar claims before consuming the jti', async () => {
    const payloads = [
      evidencePayload({ emailVerified: false }),
      evidencePayload({
        user: { id: 'user_1', email: '0x1111111111111111111111111111111111111111@tangle.tools' },
      }),
      evidencePayload({
        funding: { kind: 'paid_purchase', id: 'p', amountUsd: 0, paidAt: '2026-08-10T11:00:00.000Z' },
      }),
    ]
    for (const payload of payloads) {
      await expect(verifyEvidence(await signedEvidence({ payload }))).resolves.toBeNull()
    }
  })

  it('accepts addresses accepted by the shared Platform email contract', async () => {
    const payload = evidencePayload({ user: { id: 'user_1', email: 'test@example.com' } })
    await expect(verifyEvidence(await signedEvidence({ payload }))).resolves.not.toBeNull()
  })

  it('rejects a lookalike object copied from a verified result', async () => {
    const parsed = await verifyEvidence(await signedEvidence())
    if (!parsed) throw new Error('test fixture did not verify')
    const lookalike = structuredClone(parsed)
    expect(decideBillingAccess({ evidence: lookalike })).toMatchObject({
      allowed: false,
      code: 'platform_evidence_required',
    })
  })

  it('freezes verified evidence so a caller cannot rewrite its funding basis', async () => {
    const parsed = await verifyEvidence(await signedEvidence())
    if (!parsed) throw new Error('test fixture did not verify')
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
