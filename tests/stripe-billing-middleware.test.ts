import { generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { requireActiveSubscription } from '../src/stripe/middleware'
import {
  InMemorySubscriptionStore,
  makeSubscriptionRecord,
  type SubscriptionRecord,
} from '../src/stripe/subscription-state'
import { BillingError } from '../src/stripe/errors'
import {
  verifyTrustedPlatformEvidence,
  type TrustedPlatformEvidence,
} from '../src/billing-access-policy'
import { InMemoryAtomicIdempotencyStore } from '../src/idempotency'

let paidEvidenceValue: TrustedPlatformEvidence
let namedServiceEvidenceValue: TrustedPlatformEvidence

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const now = Math.floor(Date.now() / 1000)
  const verify = async (token: string, expectedUserId: string) => {
    const evidence = await verifyTrustedPlatformEvidence(token, {
      audience: 'stripe-middleware-tests',
      expectedUserId,
      verificationKey: publicKey,
      replayStore: new InMemoryAtomicIdempotencyStore(),
      runtime: 'test',
    })
    if (!evidence) throw new Error('invalid signed test evidence')
    return evidence
  }
  paidEvidenceValue = await verify(await new SignJWT({
    policyVersion: 1,
    emailVerified: true,
    principal: { kind: 'human' },
    user: { id: 'user_1', email: 'person@company.com' },
    funding: {
      kind: 'paid_subscription',
      id: 'funding-sub_1',
      subscriptionId: 'sub_1',
      status: 'active',
      amountUsd: 29,
    },
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setIssuer('id.tangle.tools')
    .setAudience('stripe-middleware-tests')
    .setSubject('user_1')
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .setExpirationTime(now + 300)
    .setJti('stripe-paid-evidence')
    .sign(privateKey), 'user_1')
  namedServiceEvidenceValue = await verify(await new SignJWT({
    policyVersion: 1,
    principal: { kind: 'service_principal', id: 'service:blueprint-agent', name: 'blueprint-agent' },
    user: { id: 'service-user' },
    funding: {
      kind: 'named_service',
      id: 'service-funding',
      serviceId: 'service:blueprint-agent',
      serviceName: 'blueprint-agent',
    },
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setIssuer('id.tangle.tools')
    .setAudience('stripe-middleware-tests')
    .setSubject('service-user')
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .setExpirationTime(now + 300)
    .setJti('stripe-service-evidence')
    .sign(privateKey), 'service-user')
})

function paidEvidence(): TrustedPlatformEvidence {
  return paidEvidenceValue
}

function namedServiceEvidence(): TrustedPlatformEvidence {
  return namedServiceEvidenceValue
}

function seededStore(state: SubscriptionRecord['state'], overrides: Partial<SubscriptionRecord> = {}) {
  const store = new InMemorySubscriptionStore()
  const rec = makeSubscriptionRecord({
    workspaceId: 'ws_1',
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    state,
    priceId: 'price_1',
    currentPeriodEnd: 1_700_000_000,
    trialEnd: overrides.trialEnd ?? null,
  })
  return { store, rec: { ...rec, ...overrides } }
}

describe('requireActiveSubscription', () => {
  it('returns subscription_required when no record exists', async () => {
    const out = await requireActiveSubscription({
      workspaceId: 'ws_unknown',
      store: new InMemorySubscriptionStore(),
    })
    expect(out.allowed).toBe(false)
    if (!out.allowed) {
      expect(out.error).toBeInstanceOf(BillingError)
      expect(out.error.billingCode).toBe('subscription_required')
      expect(out.error.status).toBe(403)
    }
  })

  it('allows active subscription with no warning', async () => {
    const { store, rec } = seededStore('active')
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store, accessEvidence: paidEvidence() })
    expect(out.allowed).toBe(true)
    if (out.allowed) {
      expect(out.warn).toBeUndefined()
      expect(out.record.state).toBe('active')
    }
  })

  it('allows past_due with a past_due warning (dunning grace)', async () => {
    const { store, rec } = seededStore('past_due')
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store, accessEvidence: paidEvidence() })
    expect(out.allowed).toBe(true)
    if (out.allowed) expect(out.warn).toBe('past_due')
  })

  it('denies past_due when denyPastDue=true (strict mode for irreversible actions)', async () => {
    const { store, rec } = seededStore('past_due')
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store, denyPastDue: true, accessEvidence: paidEvidence() })
    expect(out.allowed).toBe(false)
    if (!out.allowed) {
      expect(out.error.billingCode).toBe('subscription_past_due')
    }
  })

  it('denies canceled with subscription_inactive billing code', async () => {
    const { store, rec } = seededStore('canceled')
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store, accessEvidence: paidEvidence() })
    expect(out.allowed).toBe(false)
    if (!out.allowed) {
      expect(out.error.billingCode).toBe('subscription_inactive')
    }
  })

  it('denies a trialing subscription as product-funded trial access', async () => {
    const trialEnd = Math.floor(Date.now() / 1000) + 60 * 60 // 1h from now
    const { store, rec } = seededStore('trialing', { trialEnd })
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store, accessEvidence: paidEvidence() })
    expect(out.allowed).toBe(false)
    if (!out.allowed) expect(out.error.billingCode).toBe('trial_expired')
  })

  it('denies a trialing subscription even when the trial end is far away', async () => {
    const trialEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 30d
    const { store, rec } = seededStore('trialing', { trialEnd })
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store, accessEvidence: paidEvidence() })
    expect(out.allowed).toBe(false)
    if (!out.allowed) expect(out.error.billingCode).toBe('trial_expired')
  })

  it('requires Platform evidence before allowing an active subscription', async () => {
    const { store, rec } = seededStore('active')
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store })
    expect(out.allowed).toBe(false)
    if (!out.allowed) expect(out.error.billingCode).toBe('platform_evidence_required')
  })

  it('preserves an explicitly named service context for active subscriptions', async () => {
    const { store, rec } = seededStore('active')
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store, accessEvidence: namedServiceEvidence() })
    expect(out.allowed).toBe(true)
  })
})
