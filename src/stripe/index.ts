/**
 * @stable Production-grade Stripe billing layer.
 *
 * Six pieces, one subpath:
 *
 *   subscription-state.ts  — eight-state machine + persistence adapters
 *   webhooks.ts            — typed event dispatcher on top of WebhookRouter
 *   pricing.ts             — PricingPlan shape + checkout/portal URL helpers
 *   tenant-config.ts       — per-product Stripe key routing
 *   middleware.ts          — requireActiveSubscription + trial + free-tier
 *   errors.ts              — BillingError taxonomy on IntegrationRuntimeError
 *
 * Layering:
 *
 *   product agent
 *     ├─ HTTP route → requireActiveSubscription({ workspaceId, store })
 *     │                                                ↑
 *     │                              SubscriptionStore │ (FS / D1 / Postgres)
 *     │                                                │
 *     ├─ /webhook/stripe → WebhookRouter (verify + dedup)
 *     │                            ↓ deliver(envelope)
 *     │                    StripeBillingDispatcher.dispatch(envelope)
 *     │                            ↓ saveIfVersion
 *     │                    SubscriptionStore   listener(typed event)
 *     │
 *     ├─ /checkout → createCheckoutUrl(getStripeClient(productId), …)
 *     └─ /portal   → createBillingPortalUrl(getStripeClient(productId), …)
 *
 * The substrate that #45 shipped (`stripePackConnector`,
 * `stripeWebhookProvider`) is unchanged — this module sits on top:
 *   - `stripeWebhookProvider` verifies HMAC, parses to envelope.
 *   - `StripeBillingDispatcher` consumes the envelope.
 *   - `stripePackConnector` remains the mutation surface for agent
 *     tool-calls (find_customer, create_invoice, cancel_subscription).
 */

export * from './errors.js'
export * from './subscription-state.js'
export * from './webhooks.js'
export * from './pricing.js'
export * from './tenant-config.js'
export * from './middleware.js'
