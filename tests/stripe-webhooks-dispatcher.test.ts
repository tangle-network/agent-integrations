import { describe, expect, it, vi } from 'vitest'
import {
  combineListeners,
  StripeBillingDispatcher,
  type StripeBillingEvent,
  type StripeBillingListener,
} from '../src/stripe/webhooks'
import {
  InMemorySubscriptionStore,
  makeSubscriptionRecord,
  type SubscriptionRecord,
} from '../src/stripe/subscription-state'
import type { WebhookEnvelope } from '../src/webhooks/router'

function makeEnvelope(payload: unknown, type = 'customer.subscription.updated'): WebhookEnvelope {
  return {
    provider: 'stripe',
    eventType: type,
    receivedAt: Date.now(),
    payload,
    headers: {},
  }
}

function subEvent(opts: {
  id: string
  type: string
  status: string
  workspaceId?: string
  customerId?: string
  subscriptionId?: string
  priceId?: string
  trialEnd?: number | null
  cancelAtPeriodEnd?: boolean | null
  currentPeriodEnd?: number | null
}) {
  return {
    id: opts.id,
    type: opts.type,
    created: 1,
    data: {
      object: {
        id: opts.subscriptionId ?? 'sub_1',
        status: opts.status,
        customer: opts.customerId ?? 'cus_1',
        current_period_end: opts.currentPeriodEnd ?? 1_700_000_000,
        cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
        trial_end: opts.trialEnd ?? null,
        items: { data: [{ price: { id: opts.priceId ?? 'price_1' } }] },
        metadata: opts.workspaceId ? { workspaceId: opts.workspaceId } : {},
      },
    },
  }
}

describe('StripeBillingDispatcher — created', () => {
  it('persists the initial record from customer.subscription.created and emits typed event', async () => {
    const store = new InMemorySubscriptionStore()
    const captured: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        captured.push(e)
      },
    })

    await dispatcher.dispatch(
      makeEnvelope(
        subEvent({
          id: 'evt_1',
          type: 'customer.subscription.created',
          status: 'trialing',
          workspaceId: 'ws_1',
        }),
        'customer.subscription.created',
      ),
    )
    const stored = await store.load('ws_1')
    expect(stored?.state).toBe('trialing')
    expect(stored?.lastEventId).toBe('evt_1')
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ kind: 'subscription.created', eventId: 'evt_1' })
  })

  it('drops a created event when a non-incomplete record already exists (out-of-order)', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'p',
      currentPeriodEnd: 1,
    }))
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        events.push(e)
      },
    })
    await dispatcher.dispatch(
      makeEnvelope(
        subEvent({
          id: 'evt_2',
          type: 'customer.subscription.created',
          status: 'active',
          workspaceId: 'ws_1',
        }),
        'customer.subscription.created',
      ),
    )
    expect(events[0]).toMatchObject({ kind: 'event_dropped_out_of_order' })
  })

  it('replays are observable as event_replay (lastEventId match)', async () => {
    const store = new InMemorySubscriptionStore()
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        events.push(e)
      },
    })
    const env = makeEnvelope(
      subEvent({
        id: 'evt_3',
        type: 'customer.subscription.created',
        status: 'active',
        workspaceId: 'ws_1',
      }),
      'customer.subscription.created',
    )
    await dispatcher.dispatch(env)
    await dispatcher.dispatch(env)
    expect(events.map((e) => e.kind)).toEqual(['subscription.created', 'event_replay'])
  })
})

describe('StripeBillingDispatcher — updated', () => {
  it('advances state on a valid transition with version bump', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'price_1',
      currentPeriodEnd: 1,
    }))
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        events.push(e)
      },
    })
    await dispatcher.dispatch(
      makeEnvelope(
        subEvent({ id: 'evt_u', type: 'customer.subscription.updated', status: 'past_due', workspaceId: 'ws_1' }),
        'customer.subscription.updated',
      ),
    )
    const stored = (await store.load('ws_1'))!
    expect(stored.state).toBe('past_due')
    expect(stored.version).toBe(1)
    expect(events[0]).toMatchObject({
      kind: 'subscription.updated',
      previousState: 'active',
    })
  })

  it('drops out-of-order updates instead of throwing (Stripe does not guarantee order)', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'canceled',
      priceId: null,
      currentPeriodEnd: null,
    }))
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        events.push(e)
      },
    })
    await dispatcher.dispatch(
      makeEnvelope(
        subEvent({ id: 'evt_x', type: 'customer.subscription.updated', status: 'active', workspaceId: 'ws_1' }),
        'customer.subscription.updated',
      ),
    )
    expect(events[0]).toMatchObject({ kind: 'event_dropped_out_of_order' })
  })
})

describe('StripeBillingDispatcher — deleted + lifecycle', () => {
  it('transitions to canceled and emits subscription.deleted', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'p',
      currentPeriodEnd: 1,
    }))
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        events.push(e)
      },
    })
    await dispatcher.dispatch(
      makeEnvelope(
        subEvent({ id: 'evt_d', type: 'customer.subscription.deleted', status: 'canceled', workspaceId: 'ws_1' }),
        'customer.subscription.deleted',
      ),
    )
    const stored = (await store.load('ws_1'))!
    expect(stored.state).toBe('canceled')
    expect(events[0]).toMatchObject({ kind: 'subscription.deleted' })
  })

  it('a second delete on an already-canceled record is a replay no-op', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'canceled',
      priceId: null,
      currentPeriodEnd: null,
    }))
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        events.push(e)
      },
    })
    await dispatcher.dispatch(
      makeEnvelope(
        subEvent({ id: 'evt_d2', type: 'customer.subscription.deleted', status: 'canceled', workspaceId: 'ws_1' }),
        'customer.subscription.deleted',
      ),
    )
    expect(events[0]).toMatchObject({ kind: 'event_replay' })
  })

  it('paused + resumed transition via handleSubLifecycle', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'p',
      currentPeriodEnd: 1,
    }))
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        events.push(e)
      },
    })
    await dispatcher.dispatch(
      makeEnvelope(
        subEvent({ id: 'evt_p', type: 'customer.subscription.paused', status: 'paused', workspaceId: 'ws_1' }),
        'customer.subscription.paused',
      ),
    )
    await dispatcher.dispatch(
      makeEnvelope(
        subEvent({ id: 'evt_r', type: 'customer.subscription.resumed', status: 'active', workspaceId: 'ws_1' }),
        'customer.subscription.resumed',
      ),
    )
    expect(events.map((e) => e.kind)).toEqual(['subscription.paused', 'subscription.resumed'])
    expect((await store.load('ws_1'))!.state).toBe('active')
  })
})

describe('StripeBillingDispatcher — invoice', () => {
  it('emits invoice.paid with the amount and the loaded record (when present)', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'p',
      currentPeriodEnd: 1,
    }))
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        events.push(e)
      },
    })
    await dispatcher.dispatch(
      makeEnvelope(
        {
          id: 'evt_ip',
          type: 'invoice.paid',
          data: {
            object: {
              id: 'in_1',
              customer: 'cus_1',
              amount_paid: 4200,
              metadata: { workspaceId: 'ws_1' },
            },
          },
        },
        'invoice.paid',
      ),
    )
    expect(events[0]).toMatchObject({ kind: 'invoice.paid', invoiceId: 'in_1', amountPaid: 4200 })
    expect((events[0] as { record: SubscriptionRecord | null }).record?.workspaceId).toBe('ws_1')
  })

  it('emits invoice.payment_failed and degrades to record:null when no workspaceId resolvable', async () => {
    const store = new InMemorySubscriptionStore()
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        events.push(e)
      },
    })
    await dispatcher.dispatch(
      makeEnvelope(
        {
          id: 'evt_if',
          type: 'invoice.payment_failed',
          data: { object: { id: 'in_2', amount_due: 1000 } },
        },
        'invoice.payment_failed',
      ),
    )
    expect(events[0]).toMatchObject({
      kind: 'invoice.payment_failed',
      invoiceId: 'in_2',
      amountDue: 1000,
      record: null,
    })
  })
})

describe('StripeBillingDispatcher — meta', () => {
  it('unhandled event types emit event_unhandled instead of throwing', async () => {
    const store = new InMemorySubscriptionStore()
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (e) => {
        events.push(e)
      },
    })
    await dispatcher.dispatch(
      makeEnvelope({ id: 'evt_z', type: 'charge.captured', data: { object: {} } }, 'charge.captured'),
    )
    expect(events[0]).toMatchObject({ kind: 'event_unhandled', type: 'charge.captured' })
  })

  it('routes onError when payload lacks event id/type', async () => {
    const onError = vi.fn()
    const dispatcher = new StripeBillingDispatcher({
      store: new InMemorySubscriptionStore(),
      onError,
    })
    await dispatcher.dispatch(makeEnvelope({ data: { object: {} } }))
    expect(onError).toHaveBeenCalled()
  })

  it('listener errors are caught and surfaced via onError', async () => {
    const onError = vi.fn()
    const dispatcher = new StripeBillingDispatcher({
      store: new InMemorySubscriptionStore(),
      onError,
      listener: () => {
        throw new Error('listener boom')
      },
    })
    await dispatcher.dispatch(
      makeEnvelope({ id: 'evt_z', type: 'charge.captured', data: { object: {} } }, 'charge.captured'),
    )
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ eventId: 'evt_z' }))
  })
})

describe('combineListeners', () => {
  it('fans out events to every listener in declaration order', async () => {
    const calls: string[] = []
    const a: StripeBillingListener = (e) => {
      calls.push(`a:${e.kind}`)
    }
    const b: StripeBillingListener = async (e) => {
      calls.push(`b:${e.kind}`)
    }
    await combineListeners(a, b)({ kind: 'event_unhandled', eventId: 'x', type: 'whatever' })
    expect(calls).toEqual(['a:event_unhandled', 'b:event_unhandled'])
  })
})
