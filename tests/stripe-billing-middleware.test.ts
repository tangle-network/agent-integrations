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
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store })
    expect(out.allowed).toBe(true)
    if (out.allowed) {
      expect(out.warn).toBeUndefined()
      expect(out.record.state).toBe('active')
    }
  })

  it('allows past_due with a past_due warning (dunning grace)', async () => {
    const { store, rec } = seededStore('past_due')
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store })
    expect(out.allowed).toBe(true)
    if (out.allowed) expect(out.warn).toBe('past_due')
  })

  it('denies past_due when denyPastDue=true (strict mode for irreversible actions)', async () => {
    const { store, rec } = seededStore('past_due')
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store, denyPastDue: true })
    expect(out.allowed).toBe(false)
    if (!out.allowed) {
      expect(out.error.billingCode).toBe('subscription_past_due')
    }
  })

  it('denies canceled with subscription_inactive billing code', async () => {
    const { store, rec } = seededStore('canceled')
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store })
    expect(out.allowed).toBe(false)
    if (!out.allowed) {
      expect(out.error.billingCode).toBe('subscription_inactive')
    }
  })

  it('attaches trial_ending warning when trial ends within 72h', async () => {
    const trialEnd = Math.floor(Date.now() / 1000) + 60 * 60 // 1h from now
    const { store, rec } = seededStore('trialing', { trialEnd })
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store })
    expect(out.allowed).toBe(true)
    if (out.allowed) expect(out.warn).toBe('trial_ending')
  })

  it('omits trial_ending when trial is far in the future', async () => {
    const trialEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 30d
    const { store, rec } = seededStore('trialing', { trialEnd })
    await store.save(rec)
    const out = await requireActiveSubscription({ workspaceId: 'ws_1', store })
    if (!out.allowed) throw new Error('expected allowed')
    expect(out.warn).toBeUndefined()
  })
})

describe('withTrialAccess', () => {
  const trialStore = (createdAt: number | null): TrialStore => ({
    getCreatedAt: () => createdAt,
  })

  it('returns inTrial=false when workspace has no creation timestamp', async () => {
    const out = await withTrialAccess({ workspaceId: 'ws', days: 14, trialStore: trialStore(null) })
    expect(out).toEqual({ inTrial: false, daysRemaining: 0, trialEndsAt: null })
  })

  it('inTrial when within the window, daysRemaining floored', async () => {
    const now = 1_700_000_000_000
    const createdAt = now - 5 * 24 * 60 * 60 * 1000 - 3_600_000 // 5d 1h ago
    const out = await withTrialAccess({
      workspaceId: 'ws',
      days: 14,
      trialStore: trialStore(createdAt),
      now: () => now,
    })
    expect(out.inTrial).toBe(true)
    expect(out.daysRemaining).toBe(8)
    expect(out.trialEndsAt).toBe(createdAt + 14 * 24 * 60 * 60 * 1000)
  })

  it('inTrial=false when expired', async () => {
    const now = 1_700_000_000_000
    const createdAt = now - 30 * 24 * 60 * 60 * 1000
    const out = await withTrialAccess({
      workspaceId: 'ws',
      days: 14,
      trialStore: trialStore(createdAt),
      now: () => now,
    })
    expect(out.inTrial).toBe(false)
    expect(out.daysRemaining).toBe(0)
  })
})

describe('getRemainingFreeTier', () => {
  const fts = (used: number, total: number): FreeTierStore => ({ getUsage: () => ({ used, total }) })

  it('reports exhausted when used >= total', async () => {
    expect(await getRemainingFreeTier({ workspaceId: 'w', freeTierStore: fts(100, 100) })).toEqual({
      remaining: 0,
      total: 100,
      exhausted: true,
    })
  })

  it('caps remaining at zero, never negative', async () => {
    expect(await getRemainingFreeTier({ workspaceId: 'w', freeTierStore: fts(150, 100) })).toEqual({
      remaining: 0,
      total: 100,
      exhausted: true,
    })
  })

  it('reports remaining when under quota', async () => {
    expect(await getRemainingFreeTier({ workspaceId: 'w', freeTierStore: fts(20, 100) })).toEqual({
      remaining: 80,
      total: 100,
      exhausted: false,
    })
  })
})

describe('gateSubscriptionOrTrial', () => {
  it('passes via trial without needing a subscription record', async () => {
    const store = new InMemorySubscriptionStore()
    const now = Date.now()
    const trialStore: TrialStore = { getCreatedAt: () => now - 24 * 60 * 60 * 1000 } // 1d ago
    const out = await gateSubscriptionOrTrial({
      workspaceId: 'ws_new',
      store,
      trialStore,
      trialDays: 7,
    })
    expect(out.allowed).toBe(true)
    if (out.allowed) {
      expect(out.viaTrial).toBe(true)
      expect(out.record.state).toBe('trialing')
    }
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
