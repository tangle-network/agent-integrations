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
  created?: number
}) {
  return {
    id: opts.id,
    type: opts.type,
    created: opts.created ?? 1,
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
    expect(stored?.lastEventCreatedAt).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ kind: 'subscription.trial_ignored', eventId: 'evt_1' })
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
    expect(stored.version).toBe(2)
    expect(stored.pendingEventId).toBeNull()
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

  it('does not let a different Stripe subscription mutate the workspace record', async () => {
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
      listener: (event) => { events.push(event) },
    })

    await dispatcher.dispatch(makeEnvelope(
      subEvent({
        id: 'evt_foreign',
        type: 'customer.subscription.updated',
        status: 'canceled',
        workspaceId: 'ws_1',
        customerId: 'cus_attacker',
        subscriptionId: 'sub_attacker',
      }),
      'customer.subscription.updated',
    ))

    expect((await store.load('ws_1'))?.state).toBe('active')
    expect(events[0]).toMatchObject({ kind: 'event_dropped_out_of_order', eventId: 'evt_foreign' })
    expect((events[0] as { reason: string }).reason).toContain('identity')
  })

  it('persists the newest Stripe timestamp and rejects an older valid transition', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'price_1',
      currentPeriodEnd: 1,
      eventCreatedAt: 50,
    }))
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (event) => { events.push(event) },
    })

    await dispatcher.dispatch(makeEnvelope(subEvent({
      id: 'evt_newer',
      type: 'customer.subscription.updated',
      status: 'past_due',
      workspaceId: 'ws_1',
      created: 200,
    }), 'customer.subscription.updated'))
    await dispatcher.dispatch(makeEnvelope(subEvent({
      id: 'evt_older',
      type: 'customer.subscription.updated',
      status: 'active',
      workspaceId: 'ws_1',
      created: 100,
    }), 'customer.subscription.updated'))

    const stored = await store.load('ws_1')
    expect(stored?.state).toBe('past_due')
    expect(stored?.lastEventCreatedAt).toBe(200)
    expect(events.map((event) => event.kind)).toEqual([
      'subscription.updated',
      'event_dropped_out_of_order',
    ])
    expect((events[1] as { reason: string }).reason).toContain('older than stored=200')
  })

  it('returns a retryable failure for an equal timestamp without Stripe reconciliation', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'price_1',
      currentPeriodEnd: 1,
      eventCreatedAt: 50,
    }))
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (event) => { events.push(event) },
    })

    await dispatcher.dispatch(makeEnvelope(subEvent({
      id: 'evt_same_second_newer',
      type: 'customer.subscription.updated',
      status: 'past_due',
      workspaceId: 'ws_1',
      priceId: 'price_new',
      created: 200,
    }), 'customer.subscription.updated'))
    await expect(dispatcher.dispatch(makeEnvelope(subEvent({
      id: 'evt_same_second_ambiguous',
      type: 'customer.subscription.updated',
      status: 'active',
      workspaceId: 'ws_1',
      priceId: 'price_old',
      created: 200,
    }), 'customer.subscription.updated'))).rejects.toThrow(
      'equal event.created timestamps require Stripe reconciliation',
    )

    const stored = await store.load('ws_1')
    expect(stored).toMatchObject({
      state: 'past_due',
      priceId: 'price_new',
      lastEventCreatedAt: 200,
    })
    expect(events).toHaveLength(1)
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

  it('reconciles an equal-timestamp cancellation before acknowledging it', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'price_1',
      currentPeriodEnd: 100,
      eventId: 'evt_active_same_second',
      eventCreatedAt: 200,
    }))
    const events: StripeBillingEvent[] = []
    const retrieved: string[] = []
    let retrievalAttempts = 0
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (event) => { events.push(event) },
      onError: () => undefined,
      retrieveSubscription: async (subscriptionId) => {
        retrieved.push(subscriptionId)
        retrievalAttempts++
        if (retrievalAttempts === 1) throw new Error('Stripe read unavailable')
        return {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'canceled',
          current_period_end: 200,
          cancel_at_period_end: false,
          trial_end: null,
          items: { data: [{ price: { id: 'price_1' } }] },
        }
      },
    })

    const deletion = makeEnvelope(subEvent({
      id: 'evt_cancel_same_second',
      type: 'customer.subscription.deleted',
      status: 'canceled',
      workspaceId: 'ws_1',
      created: 200,
    }), 'customer.subscription.deleted')

    await expect(dispatcher.dispatch(deletion)).rejects.toThrow('Stripe read unavailable')
    expect((await store.load('ws_1'))?.state).toBe('active')
    await expect(dispatcher.dispatch(deletion)).resolves.toBeUndefined()

    expect(retrieved).toEqual(['sub_1', 'sub_1'])
    expect(await store.load('ws_1')).toMatchObject({
      state: 'canceled',
      lastEventId: 'evt_cancel_same_second',
      lastEventCreatedAt: 200,
      pendingEventId: null,
    })
    expect(events).toEqual([
      expect.objectContaining({ kind: 'subscription.deleted', eventId: 'evt_cancel_same_second' }),
    ])
  })

  it('retries a cancellation delivered before subscription creation', async () => {
    const store = new InMemorySubscriptionStore()
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (event) => { events.push(event) },
    })
    const deletion = makeEnvelope(subEvent({
      id: 'evt_delete_before_create',
      type: 'customer.subscription.deleted',
      status: 'canceled',
      workspaceId: 'ws_1',
      created: 200,
    }), 'customer.subscription.deleted')
    const creation = makeEnvelope(subEvent({
      id: 'evt_create_after_delete',
      type: 'customer.subscription.created',
      status: 'active',
      workspaceId: 'ws_1',
      created: 100,
    }), 'customer.subscription.created')

    await expect(dispatcher.dispatch(deletion)).rejects.toThrow('subscription state is not available yet')
    await expect(dispatcher.dispatch(creation)).resolves.toBeUndefined()
    await expect(dispatcher.dispatch(deletion)).resolves.toBeUndefined()

    expect(await store.load('ws_1')).toMatchObject({
      state: 'canceled',
      lastEventId: 'evt_delete_before_create',
      lastEventCreatedAt: 200,
    })
    expect(events.map((event) => event.kind)).toEqual([
      'subscription.created',
      'subscription.deleted',
    ])
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
        subEvent({
          id: 'evt_p',
          type: 'customer.subscription.paused',
          status: 'paused',
          workspaceId: 'ws_1',
          created: 1,
        }),
        'customer.subscription.paused',
      ),
    )
    await dispatcher.dispatch(
      makeEnvelope(
        subEvent({
          id: 'evt_r',
          type: 'customer.subscription.resumed',
          status: 'active',
          workspaceId: 'ws_1',
          created: 2,
        }),
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
              subscription: 'sub_1',
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

  it('binds a current Stripe invoice through parent.subscription_details', async () => {
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
      listener: (event) => { events.push(event) },
    })

    await dispatcher.dispatch(makeEnvelope({
      id: 'evt_parent_invoice',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_parent',
          customer: 'cus_1',
          amount_paid: 4200,
          parent: {
            type: 'subscription_details',
            subscription_details: {
              subscription: 'sub_1',
              metadata: { workspaceId: 'ws_1' },
            },
          },
        },
      },
    }, 'invoice.paid'))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'invoice.paid',
      eventId: 'evt_parent_invoice',
      invoiceId: 'in_parent',
      amountPaid: 4200,
    })
  })

  it('does not emit paid entitlement for a zero-dollar invoice', async () => {
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store: new InMemorySubscriptionStore(),
      listener: (event) => { events.push(event) },
    })
    await dispatcher.dispatch(makeEnvelope({
      id: 'evt_zero',
      type: 'invoice.paid',
      data: { object: { id: 'in_zero', amount_paid: 0, customer: 'cus_1', subscription: 'sub_1' } },
    }, 'invoice.paid'))
    expect(events).toEqual([{ kind: 'invoice.zero_dollar_ignored', eventId: 'evt_zero', invoiceId: 'in_zero', amountPaid: 0 }])
  })

  it('processes one of 100 concurrent copies of the same event', async () => {
    const events: StripeBillingEvent[] = []
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'price_1',
      currentPeriodEnd: 1,
    }))
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (event) => { events.push(event) },
    })
    const envelope = makeEnvelope({
      id: 'evt_100',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_100',
          amount_paid: 100,
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { workspaceId: 'ws_1' },
        },
      },
    }, 'invoice.paid')
    const results = await Promise.allSettled(Array.from({ length: 100 }, () => dispatcher.dispatch(envelope)))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(99)
    expect(events.filter((event) => event.kind === 'invoice.paid')).toHaveLength(1)
  })

  it('retries a paid invoice delivered before subscription state exists', async () => {
    const store = new InMemorySubscriptionStore()
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store,
      listener: (event) => { events.push(event) },
    })
    const invoice = makeEnvelope({
      id: 'evt_invoice_before_state',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_before_state',
          amount_paid: 2900,
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { workspaceId: 'ws_1' },
        },
      },
    }, 'invoice.paid')

    await expect(dispatcher.dispatch(invoice)).rejects.toThrow(
      'paid invoice subscription state is not available yet',
    )
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'price_1',
      currentPeriodEnd: 100,
    }))
    await expect(dispatcher.dispatch(invoice)).resolves.toBeUndefined()
    await expect(dispatcher.dispatch(invoice)).resolves.toBeUndefined()

    expect(events.filter((event) => event.kind === 'invoice.paid')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ kind: 'event_replay', eventId: 'evt_invoice_before_state' })
  })

  it('requires a non-null invoice subscription that matches the stored record', async () => {
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
      listener: (event) => { events.push(event) },
    })

    await dispatcher.dispatch(makeEnvelope({
      id: 'evt_missing_subscription',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_missing_subscription',
          amount_paid: 100,
          customer: 'cus_1',
          metadata: { workspaceId: 'ws_1' },
        },
      },
    }, 'invoice.paid'))

    expect(events.some((event) => event.kind === 'invoice.paid')).toBe(false)
    expect(events[0]).toMatchObject({
      kind: 'event_dropped_out_of_order',
      eventId: 'evt_missing_subscription',
    })
  })

  it('does not emit paid entitlement for a foreign invoice', async () => {
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
      listener: (event) => { events.push(event) },
    })

    await dispatcher.dispatch(makeEnvelope({
      id: 'evt_foreign_invoice',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_foreign',
          amount_paid: 100,
          customer: 'cus_attacker',
          subscription: 'sub_attacker',
          metadata: { workspaceId: 'ws_1' },
        },
      },
    }, 'invoice.paid'))

    expect(events.some((event) => event.kind === 'invoice.paid')).toBe(false)
    expect(events[0]).toMatchObject({ kind: 'event_dropped_out_of_order', eventId: 'evt_foreign_invoice' })
  })

  it('emits invoice.payment_failed only for a bound subscription record', async () => {
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
        {
          id: 'evt_if',
          type: 'invoice.payment_failed',
          data: {
            object: {
              id: 'in_2',
              amount_due: 1000,
              customer: 'cus_1',
              parent: {
                type: 'subscription_details',
                subscription_details: {
                  subscription: 'sub_1',
                  metadata: { workspaceId: 'ws_1' },
                },
              },
            },
          },
        },
        'invoice.payment_failed',
      ),
    )
    expect(events[0]).toMatchObject({
      kind: 'invoice.payment_failed',
      invoiceId: 'in_2',
      amountDue: 1000,
      record: expect.objectContaining({ workspaceId: 'ws_1' }),
    })
  })

  it('drops a failed invoice when no workspace can be resolved', async () => {
    const events: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({
      store: new InMemorySubscriptionStore(),
      listener: (event) => { events.push(event) },
    })
    await dispatcher.dispatch(makeEnvelope({
      id: 'evt_if_unbound',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_unbound', amount_due: 1000, customer: 'cus_1' } },
    }, 'invoice.payment_failed'))
    expect(events[0]).toMatchObject({ kind: 'event_dropped_out_of_order', eventId: 'evt_if_unbound' })
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
    await expect(dispatcher.dispatch(makeEnvelope({ data: { object: {} } }))).rejects.toThrow(
      'missing id or type',
    )
    expect(onError).toHaveBeenCalled()
  })

  it('listener errors reach the caller and a retry can finish once', async () => {
    const onError = vi.fn()
    const events: string[] = []
    let attempts = 0
    const dispatcher = new StripeBillingDispatcher({
      store: new InMemorySubscriptionStore(),
      onError,
      listener: (event) => {
        events.push(event.kind)
        if (event.kind === 'event_unhandled' && attempts++ === 0) throw new Error('listener boom')
      },
    })
    const envelope = makeEnvelope({ id: 'evt_z', type: 'charge.captured', data: { object: {} } }, 'charge.captured')
    await expect(dispatcher.dispatch(envelope)).rejects.toThrow('listener boom')
    await expect(dispatcher.dispatch(envelope)).resolves.toBeUndefined()
    await expect(dispatcher.dispatch(envelope)).resolves.toBeUndefined()
    expect(events).toEqual(['event_unhandled', 'event_unhandled', 'event_replay'])
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ eventId: 'evt_z' }))
  })

  it('retries the original typed event when state persisted before listener failure', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_retry',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'price_1',
      currentPeriodEnd: 100,
      eventId: 'evt_prior',
      eventCreatedAt: 10,
    }))
    const seen: StripeBillingEvent[] = []
    const durableQueue = new Set<string>()
    let updateAttempts = 0
    const dispatcher = new StripeBillingDispatcher({
      store,
      onError: () => undefined,
      listener: (event) => {
        seen.push(event)
        if (event.kind !== 'subscription.updated') return
        updateAttempts++
        if (updateAttempts === 1) throw new Error('queue unavailable')
        durableQueue.add(event.eventId)
      },
    })
    const envelope = makeEnvelope(subEvent({
      id: 'evt_retry_update',
      type: 'customer.subscription.updated',
      status: 'past_due',
      workspaceId: 'ws_retry',
      created: 20,
    }))

    await expect(dispatcher.dispatch(envelope)).rejects.toThrow('queue unavailable')
    expect((await store.load('ws_retry'))?.state).toBe('past_due')
    await expect(dispatcher.dispatch(envelope)).resolves.toBeUndefined()
    await expect(dispatcher.dispatch(envelope)).resolves.toBeUndefined()

    expect(seen.map((event) => event.kind)).toEqual([
      'subscription.updated',
      'subscription.updated',
      'event_replay',
    ])
    expect(seen[1]).toMatchObject({
      kind: 'subscription.updated',
      eventId: 'evt_retry_update',
      previousState: 'active',
      record: { state: 'past_due' },
    })
    expect(durableQueue).toEqual(new Set(['evt_retry_update']))
  })

  it('blocks an intervening subscription event until the pending event is durably delivered', async () => {
    const store = new InMemorySubscriptionStore()
    await store.save(makeSubscriptionRecord({
      workspaceId: 'ws_pending',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'price_1',
      currentPeriodEnd: 100,
      eventId: 'evt_prior',
      eventCreatedAt: 10,
    }))
    const durableQueue = new Set<string>()
    let failFirstDelivery = true
    const dispatcher = new StripeBillingDispatcher({
      store,
      onError: () => undefined,
      listener: (event) => {
        if (!event.kind.startsWith('subscription.')) return
        if (event.eventId === 'evt_pending_first' && failFirstDelivery) {
          failFirstDelivery = false
          throw new Error('queue unavailable')
        }
        durableQueue.add(event.eventId)
      },
    })
    const first = makeEnvelope(subEvent({
      id: 'evt_pending_first',
      type: 'customer.subscription.updated',
      status: 'past_due',
      workspaceId: 'ws_pending',
      created: 20,
    }))
    const second = makeEnvelope(subEvent({
      id: 'evt_pending_second',
      type: 'customer.subscription.updated',
      status: 'active',
      workspaceId: 'ws_pending',
      created: 21,
    }))

    await expect(dispatcher.dispatch(first)).rejects.toThrow('queue unavailable')
    await expect(dispatcher.dispatch(second)).rejects.toThrow('still needs durable delivery')
    expect(await store.load('ws_pending')).toMatchObject({
      state: 'past_due',
      lastEventId: 'evt_pending_first',
      pendingEventId: 'evt_pending_first',
    })

    await expect(dispatcher.dispatch(first)).resolves.toBeUndefined()
    await expect(dispatcher.dispatch(second)).resolves.toBeUndefined()
    expect(await store.load('ws_pending')).toMatchObject({
      state: 'active',
      lastEventId: 'evt_pending_second',
      pendingEventId: null,
    })
    expect(durableQueue).toEqual(new Set(['evt_pending_first', 'evt_pending_second']))
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

describe('StripeBillingDispatcher — resubscribe after a terminal state', () => {
  async function seed(state: 'canceled' | 'incomplete_expired' | 'active') {
    const store = new InMemorySubscriptionStore()
    await store.save(
      makeSubscriptionRecord({
        workspaceId: 'ws_1',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        state,
        priceId: 'price_1',
        currentPeriodEnd: 1_700_000_000,
        eventId: 'evt_seed',
        eventCreatedAt: 100,
      }),
    )
    return store
  }

  it('rebinds a canceled workspace to the customer next subscription', async () => {
    const store = await seed('canceled')
    const captured: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({ store, listener: (e) => { captured.push(e) } })

    await dispatcher.dispatch(makeEnvelope(subEvent({
      id: 'evt_resub',
      type: 'customer.subscription.created',
      status: 'active',
      workspaceId: 'ws_1',
      subscriptionId: 'sub_2',
      created: 200,
    }), 'customer.subscription.created'))

    const record = await store.load('ws_1')
    expect(record?.subscriptionId).toBe('sub_2')
    expect(record?.state).toBe('active')
    // The version advances, so a concurrent writer's compare-and-set still loses.
    expect(record?.version ?? 0).toBeGreaterThan(0)
    expect(captured.map((e) => e.kind)).toContain('subscription.created')
  })

  it('rebinds an expired workspace to the customer next subscription', async () => {
    const store = await seed('incomplete_expired')
    const dispatcher = new StripeBillingDispatcher({ store })

    await dispatcher.dispatch(makeEnvelope(subEvent({
      id: 'evt_resub_expired',
      type: 'customer.subscription.created',
      status: 'active',
      workspaceId: 'ws_1',
      subscriptionId: 'sub_3',
      created: 200,
    }), 'customer.subscription.created'))

    const record = await store.load('ws_1')
    expect(record?.subscriptionId).toBe('sub_3')
    expect(record?.state).toBe('active')
  })

  it('refuses a foreign subscription while the recorded one is live', async () => {
    const store = await seed('active')
    const captured: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({ store, listener: (e) => { captured.push(e) } })

    await dispatcher.dispatch(makeEnvelope(subEvent({
      id: 'evt_foreign',
      type: 'customer.subscription.created',
      status: 'active',
      workspaceId: 'ws_1',
      subscriptionId: 'sub_9',
      created: 200,
    }), 'customer.subscription.created'))

    const record = await store.load('ws_1')
    expect(record?.subscriptionId).toBe('sub_1')
    expect(captured.map((e) => e.kind)).toContain('event_dropped_out_of_order')
  })

  it('refuses another customer subscription on a canceled record', async () => {
    const store = await seed('canceled')
    const captured: StripeBillingEvent[] = []
    const dispatcher = new StripeBillingDispatcher({ store, listener: (e) => { captured.push(e) } })

    await dispatcher.dispatch(makeEnvelope(subEvent({
      id: 'evt_other_customer',
      type: 'customer.subscription.created',
      status: 'active',
      workspaceId: 'ws_1',
      customerId: 'cus_2',
      subscriptionId: 'sub_4',
      created: 200,
    }), 'customer.subscription.created'))

    const record = await store.load('ws_1')
    expect(record?.subscriptionId).toBe('sub_1')
    expect(record?.customerId).toBe('cus_1')
    expect(captured.map((e) => e.kind)).toContain('event_dropped_out_of_order')
  })
})
