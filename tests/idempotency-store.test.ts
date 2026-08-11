import { createHmac } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FileSystemAtomicIdempotencyStore,
  InMemoryAtomicIdempotencyStore,
} from '../src/idempotency'
import {
  FileSystemStripeEventIdempotencyStore,
  StripeBillingDispatcher,
} from '../src/stripe/webhooks'
import {
  FileSystemSubscriptionStore,
  InMemorySubscriptionStore,
  makeSubscriptionRecord,
} from '../src/stripe/subscription-state'
import {
  FileSystemWebhookIdempotencyStore,
  WebhookRouter,
  stripeWebhookProvider,
} from '../src/webhooks'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-integrations-idempotency-'))
  roots.push(root)
  return root
}

function signedStripeRequest(eventId: string): {
  providerId: string
  rawBody: string
  headers: Record<string, string>
} {
  const rawBody = JSON.stringify({ id: eventId, type: 'customer.created', data: { object: {} } })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', 'whsec_test')
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
  return {
    providerId: 'stripe',
    rawBody,
    headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
  }
}

function flushDeliveries(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

describe('FileSystemAtomicIdempotencyStore', () => {
  it('allows one winner across 100 independent workers', async () => {
    const root = await makeRoot()
    const stores = Array.from({ length: 100 }, () => new FileSystemAtomicIdempotencyStore(root))

    const results = await Promise.all(stores.map((store) => store.claim('stripe:event:100-way', 60_000)))

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.filter((result) => !result)).toHaveLength(99)
  })

  it('keeps an active claim across a new store instance and releases safely', async () => {
    const root = await makeRoot()
    const first = new FileSystemAtomicIdempotencyStore(root)
    const restarted = new FileSystemAtomicIdempotencyStore(root)
    const key = 'stripe:event:restart'

    expect(await first.claim(key, 60_000)).toBe(true)
    expect(await restarted.claim(key, 60_000)).toBe(false)
    await first.release(key)
    expect(await restarted.claim(key, 60_000)).toBe(true)
  })

  it('allows the same worker to reclaim a completed claim after its TTL', async () => {
    vi.useFakeTimers()
    try {
      const store = new InMemoryAtomicIdempotencyStore()
      const key = 'stripe:event:ttl'

      expect(await store.claim(key, 1_000)).toBe(true)
      expect(await store.claim(key, 1_000)).toBe(false)
      store.complete(key)
      expect(await store.claim(key, 1_000)).toBe(false)

      vi.advanceTimersByTime(1_001)
      expect(await store.claim(key, 1_000)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps filesystem subscription CAS atomic across 100 concurrent writers', async () => {
    const root = await makeRoot()
    const first = new FileSystemSubscriptionStore(root)
    const stores = Array.from({ length: 100 }, () => new FileSystemSubscriptionStore(root))
    const base = makeSubscriptionRecord({
      workspaceId: 'workspace_cas',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'price_1',
      currentPeriodEnd: 1,
    })
    await first.save(base)
    const next = { ...base, state: 'past_due' as const, version: 1 }

    const results = await Promise.all(stores.map((store) => store.saveIfVersion(next, 0)))

    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await first.load('workspace_cas'))?.state).toBe('past_due')
  })

  it('does not make process-local storage look production-safe', () => {
    expect(() => new WebhookRouter({
      providers: [],
      deliver: () => undefined,
      resolveSecret: () => null,
      runtime: 'production',
    })).toThrow('shared atomic idempotency store is required')

    expect(() => new WebhookRouter({
      providers: [],
      deliver: () => undefined,
      resolveSecret: () => null,
      idempotency: new InMemoryAtomicIdempotencyStore(),
      runtime: 'production',
    })).toThrow('production requires a shared atomic idempotency store')

    expect(() => new StripeBillingDispatcher({
      store: new InMemorySubscriptionStore(),
      runtime: 'production',
    })).toThrow('shared atomic idempotency store is required')
  })
})

describe('cross-instance webhook boundaries', () => {
  it('deduplicates 100 signed requests across two router instances', async () => {
    const root = await makeRoot()
    const delivered: string[] = []
    const makeRouter = (store: FileSystemWebhookIdempotencyStore) => new WebhookRouter({
      providers: [stripeWebhookProvider],
      runtime: 'production',
      idempotency: store,
      resolveSecret: () => 'whsec_test',
      deliver: (event) => {
        delivered.push(event.providerEventId ?? 'missing')
      },
    })
    const routerA = makeRouter(new FileSystemWebhookIdempotencyStore(root))
    const routerB = makeRouter(new FileSystemWebhookIdempotencyStore(root))
    const request = signedStripeRequest('evt_router_cross_instance')

    const responses = await Promise.all(Array.from({ length: 100 }, (_, index) => (
      index % 2 === 0 ? routerA.handle(request) : routerB.handle(request)
    )))

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(responses.filter((response) => (response.body as { received?: number }).received === 1)).toHaveLength(1)
    await flushDeliveries()
    expect(delivered).toEqual(['evt_router_cross_instance'])
  })

  it('deduplicates direct Stripe dispatch across two dispatcher instances', async () => {
    const root = await makeRoot()
    const events: string[] = []
    const makeDispatcher = (idempotency: FileSystemStripeEventIdempotencyStore) => new StripeBillingDispatcher({
      store: new InMemorySubscriptionStore(),
      runtime: 'production',
      idempotency,
      listener: (event) => {
        events.push(event.kind)
      },
    })
    const dispatcherA = makeDispatcher(new FileSystemStripeEventIdempotencyStore(root))
    const dispatcherB = makeDispatcher(new FileSystemStripeEventIdempotencyStore(root))
    const envelope = {
      provider: 'stripe',
      eventType: 'customer.created',
      receivedAt: Date.now(),
      headers: {},
      payload: { id: 'evt_dispatch_cross_instance', type: 'customer.created', data: { object: {} } },
    }

    await Promise.all(Array.from({ length: 100 }, (_, index) => (
      index % 2 === 0 ? dispatcherA.dispatch(envelope) : dispatcherB.dispatch(envelope)
    )))

    expect(events.filter((kind) => kind === 'event_unhandled')).toHaveLength(1)
    expect(events.filter((kind) => kind === 'event_replay')).toHaveLength(99)
  })
})

describe('storage failures', () => {
  it('rejects the webhook instead of accepting it when shared storage is unavailable', async () => {
    const root = await makeRoot()
    const blockedPath = join(root, 'not-a-directory')
    await writeFile(blockedPath, 'blocked')
    const delivered: string[] = []
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      runtime: 'production',
      idempotency: new FileSystemWebhookIdempotencyStore(blockedPath),
      resolveSecret: () => 'whsec_test',
      deliver: (event) => {
        delivered.push(event.providerEventId ?? 'missing')
      },
    })

    await expect(router.handle(signedStripeRequest('evt_storage_unavailable'))).rejects.toThrow()
    await flushDeliveries()
    expect(delivered).toHaveLength(0)
  })

  it('rejects direct Stripe processing when shared storage is unavailable', async () => {
    const root = await makeRoot()
    const blockedPath = join(root, 'not-a-directory')
    await writeFile(blockedPath, 'blocked')
    const dispatcher = new StripeBillingDispatcher({
      store: new InMemorySubscriptionStore(),
      runtime: 'production',
      idempotency: new FileSystemStripeEventIdempotencyStore(blockedPath),
    })

    await expect(dispatcher.dispatch({
      provider: 'stripe',
      eventType: 'customer.created',
      receivedAt: Date.now(),
      headers: {},
      payload: { id: 'evt_storage_unavailable_dispatch', type: 'customer.created', data: { object: {} } },
    })).rejects.toThrow()
  })
})
