# Billing Access Policy

Products cannot grant company-funded value from signup, trial, promotion, fallback, or synthetic paths.

`src/billing-access-policy.ts` is the shared boundary.

Call `verifyTrustedPlatformEvidence` with a short-lived JWT signed by Platform.

Require the exact product audience and expected user id.

Use an asymmetric Platform public key or trusted JWKS resolver.

Use a shared atomic replay store in production.

The store must retain completed paid-purchase records for the package's 100-year replay period.

It must fail the claim if it cannot honor that retention period.

Pass the resulting opaque evidence object to `decideBillingAccess`.

One `paid_purchase` evidence object allows one successful decision.

Do not pass caller strings such as `paid_purchase`, `paid_subscription`, or `byok`.

The verifier rejects unsigned tokens, broad or wrong audiences, wrong subjects, expired or future tokens, replayed ids, and mismatched principals.

Platform must assign one immutable funding-record id to each billable entitlement.

Re-signing the same paid-purchase record with a new JWT id remains a replay throughout that retention period.

The paid-purchase claim is global across product audiences and principals for the same record id.

Paid subscriptions, BYOK, named services, and administrator evidence claim the JWT id only through token expiry.

Platform can issue a fresh JWT id for continuing evidence without consuming the entitlement permanently.

Service display names are signed hints.

The immutable service id and Platform funding record establish identity.

Human access requires Platform proof of a verified, non-placeholder email.

Paid purchases, paid subscriptions, BYOK, explicit named services, and external administrator evidence remain valid.

`requireActiveSubscription` also requires paid-subscription evidence that matches the stored Stripe subscription for human access.

Product-funded trials always deny access.

Checkout requires a positive plan amount and a price id in the tenant `approvedPriceIds` allowlist.

Zero-dollar invoices and trial subscription events produce diagnostic events only.

Stripe updates, deletes, lifecycle events, and paid invoices must match the stored customer and subscription identity.

Current Stripe invoices read subscription identity from `parent.subscription_details`; legacy invoices use the top-level field.

Distinct subscription events with equal timestamps use `retrieveSubscription` to read current state through authenticated Stripe access.

The dispatcher returns a failure when that read is missing, fails, or returns a mismatched subscription.

A subscription event or paid invoice that arrives before its subscription record also returns a failure for retry.

Foreign or unbound Stripe events produce diagnostics and cannot mutate state or emit paid entitlement.

The Platform exchange endpoint must validate the shared exchange schema before code consumption or key replacement.

The response can omit the one-time `apiKey` on replay, but it always returns `keyId`.

`finishConnectFlow` accepts that replay shape so it does not reject the shared contract after code consumption.

API-key verification requires `expectedProduct` and checks the returned `product`, `keyId`, and immutable `provisionedByService` fields.

The request sends Platform-side product enforcement for `router` and `sandbox`, the values the shared request contract accepts.

All other shared product values are checked against the signed-integration expectation after Platform returns the verified record.

The caller-supplied `serviceName` header does not establish key provenance.

API-key auth returns `apiKeyId`, `product`, and immutable `provisionedByService` for downstream spend attribution.

The package cannot prove that a remote deployment enforces that ordering without a live Platform credential.

Direct administrator CLI grants and their `referenceId` contract are outside this package.

## Production webhook idempotency

`WebhookRouter` and `StripeBillingDispatcher` require a shared atomic idempotency store when `runtime` is `production`.

They reject a missing store and a process-local store before accepting requests.

The router awaits every `deliver` callback before it returns 2xx.

A failed callback or a concurrent active delivery returns 503 so the provider retries.

The callback must durably enqueue with a unique `providerEventId` before it resolves.

If a callback performs a side effect before it throws, that side effect must use the same idempotency key.

`FileSystemWebhookIdempotencyStore` and `FileSystemStripeEventIdempotencyStore` provide durable file-backed claims when every worker mounts the same directory.

Use Redis, D1, Postgres, or another shared backend by implementing `AtomicIdempotencyStore` with `scope: 'shared'` and an atomic claim operation.

In-memory stores are available only for tests and explicit development runtimes.

The filesystem adapter uses an append-only decision chain and atomic hard links.

Renewal, completion, release, and takeover contend on the same next-node path.

An active owner renews its processing lease.

A crashed owner becomes recoverable after the lease.

A stale owner cannot complete or release its successor's claim.

Claim files and directories are synchronized before success returns.

Malformed or unavailable storage fails closed.

Every worker must mount one filesystem with atomic hard-link and directory-sync semantics.
