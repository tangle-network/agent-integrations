/**
 * Wire the inbound webhook router behind a single HTTP handler.
 *
 * The router takes care of signature verification, parsing, and
 * idempotency dedup. The product's `deliver()` callback runs async and
 * sees a normalized envelope.
 */

import {
  WebhookRouter,
  stripeWebhookProvider,
  docusealWebhookProvider,
  slackWebhookProvider,
} from '@tangle-network/agent-integrations/webhooks'

const idempotency = (() => {
  const seen = new Set<string>()
  return {
    seen: (id: string) => seen.has(id),
    remember: (id: string) => {
      seen.add(id)
    },
  }
})()

const router = new WebhookRouter({
  providers: [stripeWebhookProvider, docusealWebhookProvider, slackWebhookProvider],
  idempotency,
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
    console.log(`[webhook] ${event.eventType} (${event.providerEventId ?? 'no-id'})`)
    // Branch on eventType and enqueue domain-specific work here.
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
