# Router search and verified phone transports

These primitives were extracted from SUPER, but have no SUPER database, project,
pricing policy, sender number, UI, or workflow dependency. Existing Hub invocation,
connector, idempotency and webhook infrastructure is retained.

## Search: one Router, not another provider registry

```ts
import { TangleSearchClient } from '@tangle-network/agent-integrations/tangle-search'
const search = new TangleSearchClient({ apiKey: () => secretStore.routerKey(), provider: 'you' })
const result = await search.search({ query: '300 mm linear guide', maxResults: 10 }, signal)
```

`apiKey`, `baseUrl`, and the optional provider pin are host choices. No environment
variable is read automatically and no model key is repurposed. The default host is
`https://router.tangle.tools`; an explicit HTTPS origin or HTTP loopback base may
be supplied for another Router deployment. Responses cannot redirect credentials.

The Router owns upstream API keys, provider availability, billing and fallback.
The client sends exactly one POST to `/v1/search`; it does not retry a potentially
billable request. The response must match the query and any explicit provider.
The returned `id`, provider and reported costs support provenance; missing or
malformed costs stay null. No thumbnails, pagination, inventory or fair value are
invented. Provider IDs are open strings, not a second hardcoded provider registry.
The current Router protocol has no offset. Invalid options fail before dispatch.

For an application that already has an audited bounded JSON transport,
`buildTangleSearchRequest` and `parseTangleSearchResult` expose the same protocol
without another network client. Input uses `query`, `provider`, `maxResults`,
`searchRecency`, `includeDomains`, and `excludeDomains`. Provider support for filters
still depends on the Router. `maxResults` is 1–25, matching the inspected API.

Protocol reference: `tangle-network/tangle-router` commit
`8999a6a9a01d6c2872010e265327c207a73adbe9`, `app/v1/search/route.ts` and `lib/web-search.ts`.
Requalify against the actual deployment; source compatibility is not live access.

## Phone verification and SMS

```ts
import { TwilioPhoneClient, authenticateTwilioForm } from '@tangle-network/agent-integrations/twilio'
const phone = new TwilioPhoneClient({ accountSid, authToken, verifyServiceSid })
const verification = await phone.startVerification('+13105551234', signal)
const approved = await phone.checkVerification(verification.id, '+13105551234', suppliedCode, signal)
const receipt = await phone.sendMessage({
  to: '+13105551234', from: serviceNumber, body: reply,
  statusCallback: 'https://app.example/sms/status/opaque-delivery-id',
}, signal)
```

This is host-side infrastructure, **not an agent verification tool**. Twilio owns
code generation and checking. The client verifies account, service, verification
SID and phone before returning approval. The application must bind that result to
its original challenge, consent, invitation and session; a model-supplied claim
of approval is never enough. OTPs, credentials and returned provider error bodies
are not logged by this library.

SMS uses form encoding, correlation to account/from/to/SID, an optional exact status
callback, bounded response reads and no automatic retry. `queued`/`accepted`/`sent`
are not delivery. An unknown send result stays unknown; a caller must reconcile
provider history before retrying. `inspect(number)` is a read-only account/service
check, not proof that OTP or conversational messaging is deliverable. Registration,
consent, fraud/rate limits, legal policies and cost caps remain deployment work.
A messaging-only consumer can omit `verifyServiceSid`; verification calls then fail before dispatch.
The client does not shorten messages: presentation and SMS segmentation policy
belong to the application. No public signup routes are installed by this package.

## Existing webhook router

```ts
import { createTwilioWebhookProvider } from '@tangle-network/agent-integrations/webhooks'
const provider = createTwilioWebhookProvider({
  url: 'https://app.example/sms', accountSid, kind: 'message',
})
// Register this in the EXISTING WebhookRouter with durable idempotency and deliver().
```

For dynamic callback routes, the host binds the exact externally configured URL
for that route. Never trust forwarded Host headers. `kind: 'status'` includes the
status in event identity, so a queued callback cannot suppress a later delivered
callback. State ordering and workspace routing remain the consumer's concern.

`authenticateTwilioForm` is also available independently. It signs the exact URL
and all received form fields; repeated fields are rejected rather than ambiguously
normalized. It is only for form-encoded webhooks, not JSON/bodySHA256. Twilio form
signatures do not establish freshness: use the existing router's durable replay
protection. Keep the raw body. Do not accept callbacks based only on a parsed phone.

Provider references: https://www.twilio.com/docs/usage/security,
https://www.twilio.com/docs/verify/api/verification-check,
https://www.twilio.com/docs/messaging/api/message-resource.

## Validation and rollout

Run `pnpm test tests/host-primitives.test.ts tests/twilio-webhook.test.ts`,
`pnpm typecheck`, and `pnpm build` on a full checkout. Test importing the built
`tangle-search`, `twilio`, and `webhooks` package subpaths before release.
No dependency versions or lockfile entries are changed by this extraction.
See CHANGELOG.md for unreleased notes. Publish with the existing release workflow;
consumer PRs must pin an actually published version, not an invented next version.
A pre-release consumer may use reproducible build artifacts pinned to the exact upstream
commit and source hashes; those are not a claim that an npm release exists.

Authoring checks compile the new protocol modules with TypeScript 5.8.3 and execute
the same assertion bodies with Node's test runner (only the Vitest registration
import and source-to-dist paths are changed). Full-package Vitest, tsup and live
provider qualification are separate gates; no live search, OTP or SMS is claimed.
