# Billing Access Policy

Products cannot grant company-funded value from signup, trial, promotion, fallback, or synthetic paths.

`src/billing-access-policy.ts` is the shared boundary.

Call `parseTrustedPlatformEvidence` only at a response boundary owned by Platform.

Pass the resulting opaque evidence object to `decideBillingAccess`.

Do not pass caller strings such as `paid_purchase`, `paid_subscription`, or `byok`.

Human access requires Platform proof of a verified, non-placeholder email.

Paid purchases, paid subscriptions, BYOK, explicit named services, and external administrator evidence remain valid.

`requireActiveSubscription` also requires paid-subscription evidence that matches the stored Stripe subscription for human access.

Product-funded trials always deny access.

Checkout requires a positive plan amount and a price id in the tenant `approvedPriceIds` allowlist.

Zero-dollar invoices and trial subscription events produce diagnostic events only.

Stripe updates, deletes, lifecycle events, and paid invoices must match the stored customer and subscription identity.

Foreign or unbound Stripe events produce diagnostics and cannot mutate state or emit paid entitlement.

The Platform exchange endpoint must enforce `requireVerifiedEmail` before key or balance issuance.

The package cannot prove that a remote deployment enforces that ordering without a live Platform credential.

Direct administrator CLI grants are outside this package and remain unchanged.

## Production webhook idempotency

`WebhookRouter` and `StripeBillingDispatcher` require a shared atomic idempotency store when `runtime` is `production`.

They reject a missing store and a process-local store before accepting requests.

`FileSystemWebhookIdempotencyStore` and `FileSystemStripeEventIdempotencyStore` provide durable file-backed claims when every worker mounts the same directory.

Use Redis, D1, Postgres, or another shared backend by implementing `AtomicIdempotencyStore` with `scope: 'shared'` and an atomic claim operation.

In-memory stores are available only for tests and explicit development runtimes.

The filesystem adapter stores one claim per hashed key and uses an exclusive per-key lock plus atomic replacement.

The lock lease recovers after a worker crash; malformed or unavailable storage fails closed.
