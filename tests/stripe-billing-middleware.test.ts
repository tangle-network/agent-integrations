import { describe, expect, it } from 'vitest'
import {
  gateSubscriptionOrTrial,
  getRemainingFreeTier,
  requireActiveSubscription,
  withTrialAccess,
  type FreeTierStore,
  type TrialStore,
} from '../src/stripe/middleware'
import {
  InMemorySubscriptionStore,
  makeSubscriptionRecord,
  type SubscriptionRecord,
} from '../src/stripe/subscription-state'
import { BillingError } from '../src/stripe/errors'
import { parseTrustedPlatformEvidence } from '../src/billing-access-policy'

function paidEvidence(subscriptionId = 'sub_1') {
  const evidence = parseTrustedPlatformEvidence({
    policyVersion: 1,
    issuer: 'id.tangle.tools',
    evidenceId: `evidence-${subscriptionId}`,
    issuedAt: '2026-08-10T12:00:00.000Z',
    emailVerified: true,
    principal: { kind: 'human' },
    user: { id: 'user_1', email: 'person@company.com' },
    funding: {
      kind: 'paid_subscription',
      id: `funding-${subscriptionId}`,
      subscriptionId,
      status: 'active',
      amountUsd: 29,
    },
  }, { expectedUserId: 'user_1' })
  if (!evidence) throw new Error('invalid test evidence')
  return evidence
}

function namedServiceEvidence() {
  const evidence = parseTrustedPlatformEvidence({
    policyVersion: 1,
    issuer: 'id.tangle.tools',
    evidenceId: 'service-evidence',
    issuedAt: '2026-08-10T12:00:00.000Z',
    principal: { kind: 'service_principal', id: 'service:blueprint-agent', name: 'blueprint-agent' },
    user: { id: 'service-user' },
    funding: {
      kind: 'named_service',
      id: 'service-funding',
      serviceId: 'service:blueprint-agent',
      serviceName: 'blueprint-agent',
    },
  })
  if (!evidence) throw new Error('invalid service evidence')
  return evidence
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

describe('withTrialAccess', () => {
  it('always denies without reading signup or workspace timestamps', async () => {
    const trialStore: TrialStore = {
      getCreatedAt: () => {
        throw new Error('trial store must not be read')
      },
    }
    const out = await withTrialAccess({
      workspaceId: 'ws',
      days: 14,
      trialStore,
      now: () => 1_700_000_000_000,
    })
    expect(out).toEqual({ inTrial: false, daysRemaining: 0, trialEndsAt: null })
  })
})

describe('getRemainingFreeTier', () => {
  const fts = (used: number, total: number): FreeTierStore => ({ getUsage: () => ({ used, total }) })

  it('reports exhausted when used >= total', async () => {
    expect(await getRemainingFreeTier({ workspaceId: 'w', freeTierStore: fts(100, 100) })).toEqual({
      remaining: 0,
      total: 0,
      exhausted: true,
    })
  })

  it('caps remaining at zero, never negative', async () => {
    expect(await getRemainingFreeTier({ workspaceId: 'w', freeTierStore: fts(150, 100) })).toEqual({
      remaining: 0,
      total: 0,
      exhausted: true,
    })
  })

  it('reports no quota when the consumer store says value remains', async () => {
    expect(await getRemainingFreeTier({ workspaceId: 'w', freeTierStore: fts(20, 100) })).toEqual({
      remaining: 0,
      total: 0,
      exhausted: true,
    })
  })

  it('does not read the free-tier store', async () => {
    const freeTierStore: FreeTierStore = {
      getUsage: () => {
        throw new Error('free-tier store must not be read')
      },
    }
    await expect(getRemainingFreeTier({ workspaceId: 'w', freeTierStore })).resolves.toEqual({
      remaining: 0,
      total: 0,
      exhausted: true,
    })
  })
})

describe('gateSubscriptionOrTrial', () => {
  it('does not pass via trial without a paid subscription record', async () => {
    const store = new InMemorySubscriptionStore()
    const trialStore: TrialStore = {
      getCreatedAt: () => {
        throw new Error('trial store must not be read')
      },
    }
    const out = await gateSubscriptionOrTrial({
      workspaceId: 'ws_new',
      store,
      trialStore,
      trialDays: 7,
    })
    expect(out.allowed).toBe(false)
    if (!out.allowed) expect(out.error.billingCode).toBe('subscription_required')
  })

  it('falls back to subscription gate when trial expired', async () => {
    const { store, rec } = seededStore('active')
    await store.save(rec)
    const trialStore: TrialStore = {
      getCreatedAt: () => Date.now() - 365 * 24 * 60 * 60 * 1000,
    }
    const out = await gateSubscriptionOrTrial({
      workspaceId: 'ws_1',
      store,
      trialStore,
      trialDays: 14,
      accessEvidence: paidEvidence(),
    })
    expect(out.allowed).toBe(true)
    if (out.allowed) {
      expect(out.viaTrial).toBeUndefined()
    }
  })

  it('returns the subscription error when both fail (more actionable than "trial expired")', async () => {
    const out = await gateSubscriptionOrTrial({
      workspaceId: 'nobody',
      store: new InMemorySubscriptionStore(),
      trialStore: { getCreatedAt: () => null },
      trialDays: 14,
    })
    expect(out.allowed).toBe(false)
    if (!out.allowed) {
      expect(out.error.billingCode).toBe('subscription_required')
    }
  })
})
