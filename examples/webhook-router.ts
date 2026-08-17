/**
 * Wire the inbound webhook router behind a single HTTP handler.
 *
 * The router takes care of signature verification, parsing, and
 * idempotency dedup. The product's `deliver()` callback must finish a
 * durable, idempotent enqueue before it resolves.
 *
 * `WebhookRouter` shapes its own 200 body, and `deliver()` returns void, so a
 * provider that needs a value from the request echoed back cannot be answered
 * through the router. Slack's `url_verification` handshake is that case:
 * answer it in the handler, ahead of `router.handle`.
 */

import { createHash } from 'node:crypto'
import {
  WebhookRouter,
  stripeWebhookProvider,
  docusealWebhookProvider,
  slackWebhookProvider,
  slackHandshakeResponse,
  FileSystemWebhookIdempotencyStore,
} from '@tangle-network/agent-integrations/webhooks'

// Every worker must resolve the same directory on the same durable filesystem.
// An absolute path is required: a relative one resolves against each worker's
// working directory, which silently gives two workers two stores and delivers
// an event twice with no error.
const idempotencyDir = process.env.WEBHOOK_IDEMPOTENCY_DIR
if (!idempotencyDir?.startsWith('/')) {
  throw new Error('WEBHOOK_IDEMPOTENCY_DIR must be an absolute path shared by every worker')
}
const idempotency = new FileSystemWebhookIdempotencyStore(idempotencyDir)

// A hung queue never resolves `deliver()`, so the claim's heartbeat renews the
// lease forever and every provider retry gets 503 delivery_in_progress. Bound
// the call so a stuck queue fails and releases the claim instead.
const QUEUE_TIMEOUT_MS = 10_000

/**
 * Stable key for the durable enqueue.
 *
 * Not every provider sends an event id: a DocuSeal payload can omit `event_id`.
 * `WebhookRouter` already dedupes those on a hash of the signed body, so the
 * queue key follows the same rule instead of rejecting the event.
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
    const queueUrl = process.env.WEBHOOK_QUEUE_URL
    if (!queueUrl) throw new Error('WEBHOOK_QUEUE_URL is required')
    const queued = await fetch(queueUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': enqueueKey(event),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(QUEUE_TIMEOUT_MS),
    })
    // Drain the body so the connection returns to the pool.
    await queued.arrayBuffer().catch(() => undefined)
    if (!queued.ok) throw new Error(`Webhook enqueue failed with ${queued.status}`)
  },
})

// In an HTTP handler:
//   const rawBody = await req.text()
//
//   // Answer the Slack handshake before the router: it must echo the
//   // challenge, and the router's 200 body is not the caller's to shape.
//   if (req.params.provider === 'slack') {
//     const handshake = slackHandshakeResponse(rawBody)
//     if (handshake) {
//       return new Response(JSON.stringify(handshake), {
//         status: 200,
//         headers: { 'content-type': 'application/json' },
//       })
//     }
//   }
//
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
void slackHandshakeResponse
