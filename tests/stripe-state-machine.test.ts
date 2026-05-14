import { describe, expect, it } from 'vitest'
import {
  applyTransition,
  gateAccess,
  InMemorySubscriptionStore,
  isValidTransition,
  makeSubscriptionRecord,
  SUBSCRIPTION_STATES,
  type SubscriptionRecord,
  type SubscriptionState,
} from '../src/stripe/subscription-state'
import { BillingError } from '../src/stripe/errors'

function baseRecord(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    workspaceId: 'ws_1',
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    state: 'active',
    priceId: 'price_1',
    currentPeriodEnd: 1_700_000_000,
    trialEnd: null,
    cancelAtPeriodEnd: false,
    version: 0,
    lastEventId: null,
    updatedAt: 0,
    ...overrides,
  }
}

describe('SUBSCRIPTION_STATES', () => {
  it('enumerates the eight Stripe states verbatim', () => {
    expect(SUBSCRIPTION_STATES).toEqual([
      'incomplete',
      'incomplete_expired',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'paused',
    ])
  })
})

describe('isValidTransition', () => {
  it('accepts self-edges on every state', () => {
    for (const s of SUBSCRIPTION_STATES) {
      expect(isValidTransition(s, s)).toBe(true)
    }
  })

  const legal: Array<[SubscriptionState, SubscriptionState]> = [
    ['incomplete', 'active'],
    ['incomplete', 'incomplete_expired'],
    ['trialing', 'active'],
    ['trialing', 'canceled'],
    ['active', 'past_due'],
    ['active', 'paused'],
    ['past_due', 'active'],
    ['past_due', 'unpaid'],
    ['unpaid', 'active'],
    ['paused', 'active'],
  ]
  it.each(legal)('accepts legal transition %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true)
  })

  const illegal: Array<[SubscriptionState, SubscriptionState]> = [
    ['canceled', 'active'],
    ['canceled', 'trialing'],
    ['incomplete_expired', 'active'],
    ['incomplete_expired', 'trialing'],
    ['incomplete', 'past_due'],
    ['active', 'incomplete'],
  ]
  it.each(illegal)('rejects illegal transition %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(false)
  })
})

describe('applyTransition', () => {
  it('throws BillingError with webhook_event_unknown on an illegal transition', () => {
    const current = baseRecord({ state: 'canceled' })
    try {
      applyTransition(current, { state: 'active' }, { eventId: 'evt_1' })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BillingError)
      expect((err as BillingError).billingCode).toBe('webhook_event_unknown')
      expect((err as BillingError).context.subscriptionState).toBe('canceled')
      expect((err as BillingError).context.eventId).toBe('evt_1')
    }
  })

  it('bumps version + stamps lastEventId + updatedAt on success', () => {
    const current = baseRecord({ version: 4, lastEventId: 'evt_prior' })
    const out = applyTransition(
      current,
      { state: 'past_due' },
      { eventId: 'evt_next', now: () => 12_345 },
    )
    expect(out.version).toBe(5)
    expect(out.lastEventId).toBe('evt_next')
    expect(out.updatedAt).toBe(12_345)
    expect(out.state).toBe('past_due')
  })

  it('does not mutate the input record', () => {
    const current = baseRecord({ version: 1 })
    applyTransition(current, { state: 'past_due' })
    expect(current.version).toBe(1)
    expect(current.state).toBe('active')
  })
})

describe('gateAccess', () => {
  it('allows active and trialing without warnings', () => {
    expect(gateAccess('active')).toEqual({ allowed: true })
    expect(gateAccess('trialing')).toEqual({ allowed: true })
  })

  it('allows past_due with a dunning warning (rule: do not lock customers out mid-grace)', () => {
    expect(gateAccess('past_due')).toEqual({ allowed: true, warn: 'past_due' })
  })

  it('denies paused, canceled, unpaid, incomplete, incomplete_expired', () => {
    expect(gateAccess('paused').allowed).toBe(false)
    expect(gateAccess('canceled').allowed).toBe(false)
    expect(gateAccess('unpaid').allowed).toBe(false)
    expect(gateAccess('incomplete').allowed).toBe(false)
    expect(gateAccess('incomplete_expired').allowed).toBe(false)
  })

  it('returns a reason on every deny so the middleware can typed-map', () => {
    for (const state of SUBSCRIPTION_STATES) {
      const decision = gateAccess(state)
      if (!decision.allowed) {
        expect(decision.reason).toMatch(/subscription_(inactive|past_due)|trial_expired|no_subscription/)
      }
    }
  })
})

describe('InMemorySubscriptionStore CAS', () => {
  it('round-trips load/save', async () => {
    const store = new InMemorySubscriptionStore()
    const rec = makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'p',
      currentPeriodEnd: 1,
    })
    await store.save(rec)
    expect(await store.load('ws_1')).toEqual(rec)
  })

  it('saveIfVersion accepts a clean write (no current record + expectedVersion=0)', async () => {
    const store = new InMemorySubscriptionStore()
    const rec = baseRecord({ workspaceId: 'ws_new', version: 0 })
    expect(await store.saveIfVersion(rec, 0)).toBe(true)
  })

  it('saveIfVersion rejects when the current version drifted (defends against duplicate webhook race)', async () => {
    const store = new InMemorySubscriptionStore()
    const rec = baseRecord({ version: 0 })
    await store.save(rec)
    // Simulate first writer winning by bumping version to 1.
    await store.saveIfVersion({ ...rec, version: 1 }, 0)
    // Second writer using the stale version=0 expectation must lose.
    expect(await store.saveIfVersion({ ...rec, version: 1 }, 0)).toBe(false)
  })

  it('saveIfVersion rejects a "create" when a record already exists (expected=0 but current is set)', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(baseRecord({ version: 3 }))
    expect(await store.saveIfVersion(baseRecord({ version: 1 }), 0)).toBe(false)
  })
})

describe('makeSubscriptionRecord', () => {
  it('seeds version=0 and lastEventId=null for the post-checkout initial record', () => {
    const rec = makeSubscriptionRecord({
      workspaceId: 'ws',
      customerId: 'c',
      subscriptionId: 's',
      state: 'trialing',
      priceId: 'p',
      currentPeriodEnd: 100,
      trialEnd: 200,
      cancelAtPeriodEnd: false,
      now: () => 999,
    })
    expect(rec.version).toBe(0)
    expect(rec.lastEventId).toBeNull()
    expect(rec.updatedAt).toBe(999)
  })
})
