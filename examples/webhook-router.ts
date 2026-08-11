/**
 * Wire the inbound webhook router behind a single HTTP handler.
 *
 * The router takes care of signature verification, parsing, and
 * idempotency dedup. The product's `deliver()` callback must finish a
 * durable, idempotent enqueue before it resolves.
 */

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
    if (!event.providerEventId) throw new Error('A stable provider event id is required for durable enqueue')
    const queueUrl = process.env.WEBHOOK_QUEUE_URL
    if (!queueUrl) throw new Error('WEBHOOK_QUEUE_URL is required')
    const queued = await fetch(queueUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': event.providerEventId,
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
