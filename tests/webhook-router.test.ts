import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WebhookRouter,
  stripeWebhookProvider,
  slackWebhookProvider,
  docusealWebhookProvider,
  gmailWebhookProvider,
  gdriveWebhookProvider,
  genericHmacWebhookProvider,
  hellosignWebhookProvider,
  InMemoryWebhookIdempotencyStore,
  type WebhookEnvelope,
  type WebhookIdempotencyStore,
} from '../src/webhooks/index'

function flushMicrotasks(): Promise<void> {
  // Yield once for provider callbacks that schedule their own microtasks.
  return new Promise((r) => setTimeout(r, 0))
}

describe('WebhookRouter', () => {
  afterEach(() => vi.useRealTimers())

  it('rejects unknown providers with 404', async () => {
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      deliver: async () => undefined,
      resolveSecret: async () => 'whsec',
    })
    const r = await router.handle({ providerId: 'unknown', rawBody: '{}', headers: {} })
    expect(r.status).toBe(404)
  })

  it('returns 401 when resolveSecret yields null', async () => {
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      deliver: async () => undefined,
      resolveSecret: async () => null,
    })
    const r = await router.handle({ providerId: 'stripe', rawBody: '{}', headers: {} })
    expect(r.status).toBe(401)
  })

  it('verifies a Stripe signature and delivers the parsed event', async () => {
    const delivered: WebhookEnvelope[] = []
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      deliver: async (e) => {
        delivered.push(e)
      },
      resolveSecret: async () => 'whsec_test',
    })
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ id: 'evt_1', type: 'customer.created' })
    const sig = `t=${ts},v1=${createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex')}`
    const r = await router.handle({
      providerId: 'stripe',
      rawBody: body,
      headers: { 'stripe-signature': sig },
    })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ received: 1, total: 1 })
    await flushMicrotasks()
    expect(delivered).toHaveLength(1)
    expect(delivered[0].eventType).toBe('customer.created')
    expect(delivered[0].providerEventId).toBe('evt_1')
  })

  it('returns the literal Dropbox Sign ACK body on a verified HelloSign delivery', async () => {
    const apiKey = 'hs_api_key'
    const eventType = 'signature_request_sent'
    const eventTime = '1700000040'
    const event_hash = createHmac('sha256', apiKey).update(`${eventTime}${eventType}`).digest('hex')
    const body = JSON.stringify({ event: { event_time: eventTime, event_type: eventType, event_hash } })
    const router = new WebhookRouter({
      providers: [hellosignWebhookProvider],
      deliver: async () => undefined,
      resolveSecret: async () => apiKey,
    })
    const r = await router.handle({ providerId: 'hellosign', rawBody: body, headers: {} })
    expect(r.status).toBe(200)
    // Dropbox Sign treats anything but this exact body as a failed delivery.
    expect(r.body).toBe('Hello API Event Received')
    expect(r.headers?.['content-type']).toBe('text/plain')
  })

  it('returns 401 on a Stripe signature mismatch', async () => {
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      deliver: async () => undefined,
      resolveSecret: async () => 'whsec_test',
    })
    const r = await router.handle({
      providerId: 'stripe',
      rawBody: '{}',
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
    })
    expect(r.status).toBe(401)
  })

  it('atomic idempotency claim short-circuits a duplicate event', async () => {
    const delivered: WebhookEnvelope[] = []
    const seen = new Set<string>(['evt_1'])
    const idempotency: WebhookIdempotencyStore = {
      claim: (id) => {
        const key = id.replace('stripe:id:', '')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      },
      claimStatus: (id) => {
        const key = id.replace('stripe:id:', '')
        if (seen.has(key)) return 'completed'
        seen.add(key)
        return 'acquired'
      },
      release: () => undefined,
      complete: () => undefined,
    }
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      deliver: async (e) => {
        delivered.push(e)
      },
      resolveSecret: async () => 'whsec_test',
      idempotency,
    })
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ id: 'evt_1', type: 'customer.created' })
    const sig = `t=${ts},v1=${createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex')}`
    const r = await router.handle({
      providerId: 'stripe',
      rawBody: body,
      headers: { 'stripe-signature': sig },
    })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ received: 0, total: 1 })
    await flushMicrotasks()
    expect(delivered).toHaveLength(0)
  })

  it('claims an idempotency entry before a successful deliver', async () => {
    const claimed: string[] = []
    const idempotency: WebhookIdempotencyStore = {
      claim: (id) => {
        claimed.push(id)
        return true
      },
      claimStatus: (id) => {
        claimed.push(id)
        return 'acquired'
      },
      release: () => undefined,
      complete: () => undefined,
    }
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      deliver: async () => undefined,
      resolveSecret: async () => 'whsec_test',
      idempotency,
    })
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ id: 'evt_2', type: 'invoice.paid' })
    const sig = `t=${ts},v1=${createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex')}`
    await router.handle({ providerId: 'stripe', rawBody: body, headers: { 'stripe-signature': sig } })
    await flushMicrotasks()
    expect(claimed).toEqual(['stripe:id:evt_2'])
  })

  it('delivers a duplicate webhook exactly once under 100 concurrent requests', async () => {
    const delivered: WebhookEnvelope[] = []
    let releaseDelivery!: () => void
    let deliveryStarted!: () => void
    const started = new Promise<void>((resolve) => { deliveryStarted = resolve })
    const held = new Promise<void>((resolve) => { releaseDelivery = resolve })
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      deliver: async (event) => {
        deliveryStarted()
        await held
        delivered.push(event)
      },
      resolveSecret: async () => 'whsec_test',
      idempotency: new InMemoryWebhookIdempotencyStore(),
    })
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ id: 'evt_concurrent', type: 'invoice.paid' })
    const sig = `t=${ts},v1=${createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex')}`
    const request = {
      providerId: 'stripe',
      rawBody: body,
      headers: { 'stripe-signature': sig },
    }
    const winner = router.handle(request)
    await started
    const duplicates = await Promise.all(Array.from({ length: 99 }, () => router.handle(request)))
    expect(duplicates.every((response) => response.status === 503)).toBe(true)
    expect(duplicates.every((response) => (response.body as { error?: string }).error === 'delivery_in_progress')).toBe(true)
    releaseDelivery()
    const accepted = await winner
    expect(accepted.status).toBe(200)
    expect((accepted.body as { received?: number }).received).toBe(1)
    expect(delivered).toHaveLength(1)
  })

  it('routes a DocuSeal webhook end-to-end', async () => {
    const delivered: WebhookEnvelope[] = []
    const router = new WebhookRouter({
      providers: [docusealWebhookProvider],
      deliver: async (e) => {
        delivered.push(e)
      },
      resolveSecret: async () => 'docuseal_secret',
    })
    const body = JSON.stringify({ event_type: 'submission.completed', event_id: 'evt_ds_1', data: {} })
    const sig = createHmac('sha256', 'docuseal_secret').update(body).digest('hex')
    const r = await router.handle({
      providerId: 'docuseal',
      rawBody: body,
      headers: { 'x-docuseal-signature': sig },
    })
    expect(r.status).toBe(200)
    await flushMicrotasks()
    expect(delivered[0].eventType).toBe('docuseal.submission.completed')
  })

  it('parses a Slack url_verification handshake event', async () => {
    const delivered: WebhookEnvelope[] = []
    const router = new WebhookRouter({
      providers: [slackWebhookProvider],
      deliver: async (e) => {
        delivered.push(e)
      },
      resolveSecret: async () => 'slack_signing_secret',
    })
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc' })
    const ts = Math.floor(Date.now() / 1000)
    const sig = 'v0=' + createHmac('sha256', 'slack_signing_secret').update(`v0:${ts}:${body}`).digest('hex')
    const r = await router.handle({
      providerId: 'slack',
      rawBody: body,
      headers: { 'x-slack-signature': sig, 'x-slack-request-timestamp': String(ts) },
    })
    expect(r.status).toBe(200)
    await flushMicrotasks()
    expect(delivered[0].eventType).toBe('slack.url_verification')
  })

  it('validates a Drive push via X-Goog-Channel-Token', async () => {
    const delivered: WebhookEnvelope[] = []
    const router = new WebhookRouter({
      providers: [gdriveWebhookProvider],
      deliver: async (e) => {
        delivered.push(e)
      },
      resolveSecret: async () => 'channel_token_xyz',
    })
    const r = await router.handle({
      providerId: 'gdrive',
      rawBody: '',
      headers: {
        'x-goog-channel-token': 'channel_token_xyz',
        'x-goog-channel-id': 'chan-1',
        'x-goog-resource-id': 'rsrc-1',
        'x-goog-resource-state': 'change',
        'x-goog-message-number': '7',
      },
    })
    expect(r.status).toBe(200)
    await flushMicrotasks()
    expect(delivered[0].eventType).toBe('gdrive.resource.change')
    expect(delivered[0].providerEventId).toBe('chan-1-7')
  })

  it('parses Gmail Pub/Sub envelopes', async () => {
    const delivered: WebhookEnvelope[] = []
    const router = new WebhookRouter({
      providers: [gmailWebhookProvider],
      deliver: async (e) => {
        delivered.push(e)
      },
      resolveSecret: async () => 'gmail_pubsub_secret',
    })
    const inner = JSON.stringify({ historyId: 12345, emailAddress: 'a@b.com' })
    const body = JSON.stringify({ message: { data: Buffer.from(inner).toString('base64'), messageId: 'msg-1', publishTime: '2025-01-01T00:00:00Z' } })
    const r = await router.handle({
      providerId: 'gmail',
      rawBody: body,
      headers: { authorization: 'Bearer gmail_pubsub_secret' },
    })
    expect(r.status).toBe(200)
    await flushMicrotasks()
    expect(delivered[0].eventType).toBe('gmail.history_changed')
    expect((delivered[0].payload as { historyId: number }).historyId).toBe(12345)
  })

  it('supports a generic HMAC provider', async () => {
    const delivered: WebhookEnvelope[] = []
    const provider = genericHmacWebhookProvider({
      id: 'custom',
      signatureHeader: 'x-signature',
      signaturePrefix: 'sha256=',
    })
    const router = new WebhookRouter({
      providers: [provider],
      deliver: async (e) => {
        delivered.push(e)
      },
      resolveSecret: async () => 's3cret',
    })
    const body = JSON.stringify({ foo: 'bar' })
    const sig = 'sha256=' + createHmac('sha256', 's3cret').update(body).digest('hex')
    const r = await router.handle({
      providerId: 'custom',
      rawBody: body,
      headers: { 'x-signature': sig },
    })
    expect(r.status).toBe(200)
    await flushMicrotasks()
    expect(delivered[0].eventType).toBe('custom.event')
  })

  it('returns 400 when the provider parser throws', async () => {
    const router = new WebhookRouter({
      providers: [{
        id: 'broken',
        verifySignature: () => ({ valid: true }),
        parse: () => {
          throw new Error('boom')
        },
      }],
      deliver: async () => undefined,
      resolveSecret: async () => 'x',
      onError: () => undefined,
    })
    const r = await router.handle({ providerId: 'broken', rawBody: '', headers: {} })
    expect(r.status).toBe(400)
  })

  it('returns non-2xx on delivery failure and retries the work exactly once', async () => {
    const errors: unknown[] = []
    let attempts = 0
    let credits = 0
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      deliver: async () => {
        attempts++
        if (attempts === 1) throw new Error('downstream-fail')
        credits++
      },
      resolveSecret: async () => 'whsec_test',
      onError: (err) => {
        errors.push(err)
      },
    })
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ id: 'evt_x', type: 'x' })
    const sig = `t=${ts},v1=${createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex')}`
    const request = {
      providerId: 'stripe',
      rawBody: body,
      headers: { 'stripe-signature': sig },
    }
    const failed = await router.handle(request)
    const retried = await router.handle(request)
    const replayed = await router.handle(request)
    expect(failed.status).toBe(503)
    expect((failed.body as { error?: string }).error).toBe('delivery_failed')
    expect(retried.status).toBe(200)
    expect(replayed.status).toBe(200)
    expect(attempts).toBe(2)
    expect(credits).toBe(1)
    expect(errors).toHaveLength(1)
  })

  it('retries safely when claim completion fails after a durable enqueue', async () => {
    const inner = new InMemoryWebhookIdempotencyStore()
    let completionAttempts = 0
    const idempotency: WebhookIdempotencyStore = {
      claim: (key, ttlMs) => inner.claim(key, ttlMs),
      claimStatus: (key, ttlMs) => inner.claimStatus(key, ttlMs),
      release: (key) => inner.release(key),
      complete: (key) => {
        if (completionAttempts++ === 0) throw new Error('completion storage failed')
        inner.complete(key)
      },
    }
    const queue = new Set<string>()
    let enqueueAttempts = 0
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      idempotency,
      resolveSecret: async () => 'whsec_test',
      onError: () => undefined,
      deliver: async (event) => {
        enqueueAttempts++
        if (event.providerEventId) queue.add(event.providerEventId)
      },
    })
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ id: 'evt_complete_retry', type: 'invoice.paid' })
    const sig = `t=${ts},v1=${createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex')}`
    const request = {
      providerId: 'stripe',
      rawBody: body,
      headers: { 'stripe-signature': sig },
    }

    expect((await router.handle(request)).status).toBe(503)
    expect((await router.handle(request)).status).toBe(200)
    expect(enqueueAttempts).toBe(2)
    expect(queue).toEqual(new Set(['evt_complete_retry']))
  })
})
