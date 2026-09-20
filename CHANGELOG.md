# Changelog

## 0.54.1

### Fixed
- A reviewed order no longer returns on every sweep. Each `needs_review` save carries a long retry time, so a stuck order cannot occupy the host's bounded reconcile batch and starve new orders.
- The attempt lease and the retry backoff are dated when the call is made, not when the tick began. A provider that is slow rather than broken can no longer have a live purchase declared lost, and a failure after a long timeout still backs off.
- A provider call refused before any request, such as an invalid handle or region, releases the attempt journal instead of reporting an unknown purchase outcome.
- The provider's HTTP status is preserved alongside the error code, so an operator can tell a payment refusal from an authentication failure.

## 0.54.0

### Added
- Inkbox email, SMS and iMessage actions, Linq v3, a separate Linq WhatsApp service, and corrected Contiguity actions and signatures.
  All of them use the existing connector, webhook-router and `ConversationEvent` contracts.
- Signed webhook verification for Inkbox, Linq, Linq WhatsApp and Contiguity through the existing ingress contract.
- `buildMessagingReply` derives a reply from an authenticated stored event.
  Each `ConversationReply` carries `idempotencyKey`; pass it unchanged on every retry of that reply.
- `listConversationChannels()` and a shared owned-line inventory projection.
  They describe protocol support, never deployed-account readiness.
- `@tangle-network/agent-integrations/managed-messaging`: a host-only module for Inkbox identity, SMS and dedicated iMessage provisioning, scoped-key issuance, and a journaled, resumable order driver (`advanceManagedNumber`).
  The host supplies funding, persistence, the vault and the Hub binding.
  The default entry does not export it.
- Durable broker consent receipts expose the grant, app, connection and owner identity.
  `requireBrokerGrantReceipt` verifies exact identity and scope before unattended use.
- `@tangle-network/agent-integrations/tangle-search`: a typed Router search client with explicit host credentials, request correlation, unknown-cost preservation, cancellation and bounded JSON reads.
- `@tangle-network/agent-integrations/twilio`: managed phone verification, correlated SMS receipts, native form-webhook authentication and phone normalization.
- `createTwilioWebhookProvider` in the existing `/webhooks` entrypoint.
- LinkedIn member share creation.

### Changed
- `InkboxProvisioner.provisionSms(handle, operationId, state?)` now requires a stable operation key and sends it as `Idempotency-Key`.
- Workflow dispatch rechecks each workflow's current trigger grant before it routes an event.
  It reads every candidate grant in one `listByIds` call, or with concurrent point reads when the store has no batch read.

### Fixed
- A transient failure on the ownership read after an SMS purchase no longer re-opens the order for a second purchase.
- A progress check that overlaps another worker's provider call no longer sends the order to review and discards that call's receipt.
- A completed purchase can be reconciled after its funding hold expired. Reads need no funding; every mutation still authorizes first.
- Declarative REST refuses an argument of `.` or `..` that would become a URL dot segment.
  A template's own dot segment still works.

Migration and validation: [host-search-and-phone](docs/host-search-and-phone.md).
Number activation is separate from provider rental and customer subscription billing.
