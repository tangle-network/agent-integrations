/**
 * Wire the inbound webhook router behind a single HTTP handler.
 *
 * The router takes care of signature verification, parsing, and
 * idempotency dedup. The product's `deliver()` callback must finish a
 * durable, idempotent enqueue before it resolves.
 */

import { createHash } from 'node:crypto'
import {
  WebhookRouter,
  stripeWebhookProvider,
  docusealWebhookProvider,
  slackWebhookProvider,
  FileSystemWebhookIdempotencyStore,
} from '@tangle-network/agent-integrations/webhooks'

// Every worker must mount this directory from the same durable filesystem.
const idempotency = new FileSystemWebhookIdempotencyStore(
  process.env.WEBHOOK_IDEMPOTENCY_DIR ?? './var/webhook-idempotency',
)

/**
 * Stable key for the durable enqueue.
 *
 * Not every provider sends an event id: the Slack handshake carries none, and
 * a DocuSeal payload can omit `event_id`. `WebhookRouter` already dedupes those
 * on a hash of the signed body, so the queue key follows the same rule instead
 * of rejecting the event.
 */
function enqueueKey(event: { provider: string; eventType: string; providerEventId?: string; payload: unknown }): string {
  const id = event.providerEventId?.trim()
  if (id) return `${event.provider}:id:${id}`
  const digest = createHash('sha256').update(JSON.stringify(event.payload), 'utf8').digest('hex')
  return `${event.provider}:body:${event.eventType}:${digest}`
}

const router = new WebhookRouter({
  providers: [stripeWebhookProvider, docusealWebhookProvider, slackWebhookProvider],
  idempotency,
  runtime: 'production',
  resolveSecret: async (providerId) => {
    // In production: pull from a secret manager keyed by the requesting
    // tenant. Headers (e.g., a Stripe Account-Id) are available to scope
    // the lookup when multiple tenants share a provider.
    if (providerId === 'stripe') return process.env.STRIPE_WEBHOOK_SECRET ?? null
    if (providerId === 'docuseal') return process.env.DOCUSEAL_WEBHOOK_SECRET ?? null
    if (providerId === 'slack') return process.env.SLACK_SIGNING_SECRET ?? null
    return null
  },
  deliver: async (event) => {
    // The Slack handshake is not a business event. Acknowledge it and stop:
    // a throw here returns 503 and the Slack app install fails.
    if (event.eventType === 'slack.url_verification') return

    const queueUrl = process.env.WEBHOOK_QUEUE_URL
    if (!queueUrl) throw new Error('WEBHOOK_QUEUE_URL is required')
    const queued = await fetch(queueUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': enqueueKey(event),
      },
      body: JSON.stringify(event),
    })
    if (!queued.ok) throw new Error(`Webhook enqueue failed with ${queued.status}`)
  },
})

// In an HTTP handler:
//   const rawBody = await req.text()
//   const result = await router.handle({
//     providerId: req.params.provider,
//     rawBody,
//     headers: Object.fromEntries(req.headers.entries()),
//   })
//   return new Response(JSON.stringify(result.body), {
//     status: result.status,
//     headers: { 'content-type': 'application/json' },
//   })

void router
