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
  type WebhookEnvelope,
  type WebhookIdempotencyStore,
} from '../src/webhooks/index'

function flushMicrotasks(): Promise<void> {
  // Two await ticks: queueMicrotask delivers on the next microtask; the
  // delivery itself awaits, so two ticks is enough to drain a single
  // deliver call without setImmediate.
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

  it('idempotency.seen short-circuits a duplicate event', async () => {
    const delivered: WebhookEnvelope[] = []
    const seen = new Set<string>(['evt_1'])
    const idempotency: WebhookIdempotencyStore = {
      seen: (id) => seen.has(id),
      remember: (id) => {
        seen.add(id)
      },
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

  it('records idempotency entries after a successful deliver', async () => {
    const remembered: string[] = []
    const idempotency: WebhookIdempotencyStore = {
      seen: () => false,
      remember: (id) => {
        remembered.push(id)
      },
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
    expect(remembered).toEqual(['evt_2'])
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

  it('does not block the response when deliver() throws', async () => {
    const errors: unknown[] = []
    const router = new WebhookRouter({
      providers: [stripeWebhookProvider],
      deliver: async () => {
        throw new Error('downstream-fail')
      },
      resolveSecret: async () => 'whsec_test',
      onError: (err) => {
        errors.push(err)
      },
    })
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ id: 'evt_x', type: 'x' })
    const sig = `t=${ts},v1=${createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex')}`
    const r = await router.handle({
      providerId: 'stripe',
      rawBody: body,
      headers: { 'stripe-signature': sig },
    })
    expect(r.status).toBe(200)
    await flushMicrotasks()
    expect(errors).toHaveLength(1)
  })
})
