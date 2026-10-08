# Changelog

## 0.68.0

- feat(integrations): bind native Meta WhatsApp messages to owned numbers

## 0.67.3

- fix(phony): keep ph0ny's status and message on refused calls

## 0.67.2

- fix(whatsapp): route sends through Meta phone number IDs

## 0.67.1

- fix(whatsapp): allow receipts for current media without download URLs

## 0.67.0

- feat(telegram): normalize group conversations and fail refused deliveries (#371)

## 0.66.0

- feat(github): propose changes on a new branch through Git Data actions (#369)
- feat(phony): let outbound missions name the purpose the callee hears (#368)

## 0.65.1

- fix(release): publish the verified package with npm trusted publishing

## 0.65.0

- feat(phony): bind reviewed captions to the source video and cue times (#364)

## 0.64.0

- feat(phony): pass reviewed video cues through Hub actions (#361)

## 0.63.0

- feat(phony): translate_video and get_video_job (#359)

## 0.62.0

- feat(voice): ph0ny voice memos, voices, self-clones, transcription and call outcomes; ElevenLabs voices, clones, STT and agents (#356)

## 0.61.2

- fix(clients): call fetch without the client as receiver (#354)
- feat(github): read combined commit status and check runs for a ref

## 0.61.1

- fix(ads): require native social advertising mutation receipts
- fix(linkedin-ads): expose model-safe targeting arguments

## 0.61.0

- feat(ads): publish paid advertising catalog contracts
- fix: validate native paid advertising mutation receipts
- feat(hub): register paid ads through shared credential and catalog paths
- fix(ads): require LinkedIn beneficiary and native mutation receipts
- feat(ads): add Meta TikTok and Snapchat campaign execution
- feat: add Microsoft Pinterest and Amazon paid ads adapters
- fix(x-ads): require native promoted post identity and media keys
- feat(ads): add X LinkedIn and Reddit paid campaign adapters

## 0.60.1

- feat(integrations): read scoped GTM campaign outcomes

## 0.60.0

- feat(integrations): add bounded Google Ads campaigns

## 0.59.3

- fix(conversation-events): reject malformed Linq media hosts
- fix(conversation-events): snapshot validated media URL once
- feat(conversation-events): plan authenticated Linq media replies

## 0.59.2

- fix(connectors): use model-safe tool input names (#338)

## 0.59.1

- chore(integrations): upgrade phony sdk to 0.1.3 (#334)
- fix(release): compare feature metadata from its branch point
- test: clean up claim workers during setup failures
- test: terminate claim workers after failed process result
- test: delete manifest-restating and duplicated connector unit tests (#323)
- ci(release): prepare release metadata after feature merges
- ci: reject feature-time release prep
- ci: keep release metadata out of feature PRs
- build(release): prepare version and changelog after merge

## 0.59.0

### Added

`TangleReadClient` reads bounded public HTTPS pages through the Router from the existing `tangle-search` entrypoint.
It returns untrusted text, raw byte counts, truncation, request identity, and reported cost.
Response validation preserves UTF-8 replacement expansion within the returned raw byte count.

## 0.58.0

### Changed

Runtime dependencies are updated to their latest releases, including MongoDB driver 7.
The package now requires Node.js 20.19.0 or newer, which MongoDB driver 7 requires.
The package builds with tsdown and TypeScript 7 instead of tsup and TypeScript 5.
Published entry points and export paths are unchanged.

## 0.57.0

### Changed

The ph0ny connector routes authenticated reads and writes through `@ph0ny/sdk@0.1.2`.
It keeps consent checks, argument validation, timeouts, and 401 reconnect mapping.
Its factory accepts an operator-selected staging origin and ignores origins in capability arguments.

## 0.56.0

### Added

The conversation channel catalog now describes Inkbox, Linq, Linq WhatsApp, Contiguity, Resend, Sendblue and Twilio SMS transports with their available reply and presence actions.
Sendblue and Twilio SMS adapters expose owned-line inventory, message reads and sends, and provider-specific media operations.
Conversation events normalize inbound Sendblue and Twilio SMS messages and carry transport, media, group and history markers for guarded replies.
Contiguity and Linq WhatsApp expose supported typing, reaction or read-receipt actions.

### Fixed

Twilio SMS message webhooks use a dedicated provider constructor, and MMS downloads follow a bounded HTTPS media redirect without forwarding API credentials.
Twilio line selection fetches an owned number by SID, so accounts with multiple inventory pages can bind their selected number.
Sendblue requests use the documented `api.sendblue.co` endpoint.
Resend sends and webhook replies preserve provider safety and sender checks.

## 0.55.0

### Added

Inkbox `phone.incoming_call_action.set` sets how the connected identity handles inbound calls.
It accepts only `webhook` with an HTTPS `incoming_call_webhook_url`, or `auto_reject` with a null URL.
The identity-scoped key configures its own identity, so the request never names `agent_identity_id`.
Inkbox `phone.call.place` places an outbound call from an owned E.164 number to an E.164 number.
It always sends `origination: 'dedicated_number'` and `mode: 'client_websocket'`, and it requires a `wss://` media WebSocket URL.
The result is the Inkbox call object, including its `id`.
Both capabilities are external-effect mutations and refuse invalid or unsupported arguments before any request.
Forwarding, auto-accept, Voice AI, reason and voicemail fields are not exposed.
Managed provisioning still defaults new identities to `auto_reject`.

## 0.54.4

### Added

Cloudbeds connections read bounded reservations and room availability.
They post approved folio items with a stable `referenceID`.
PriceLabs connections read advisory nightly listing prices.
Linq WhatsApp conversation events expose media parts.
The owned Hub connection can retrieve bounded private attachment bytes before their URLs expire.
Deepgram connections transcribe bounded private audio through an explicitly approved Hub mutation.
Only that billable byte action declares advisory consistency; existing Deepgram actions keep their authoritative default.
Approval, audit, sandbox, and error previews redact named private audio fields and common encoded forms.

### Fixed

Inkbox and direct email conversation events now label the From address as unverified.
A signed delivery does not prove mailbox control, and raw webhook fields are not treated as sender authentication.
Mail replies use the RFC Message-ID when Inkbox supplies it and omit threading when it is absent.
They no longer send the stored message UUID as `in_reply_to_message_id`.
A completed Deepgram transcript remains available when the optional provider request ID is malformed.
Preview redaction also catches data URLs, MIME-style wrapped base64, and common encoded values under neutral field names.

## 0.54.3

### Fixed

Update `csv-parse` to 7.0.2 for GHSA-8cw4-87c7-c6xx.
Grouped duplicate `__proto__` headers now remain own data properties instead of replacing the parsed record's prototype.
The CSV connector's exposed options are unchanged.

## 0.54.2

### Fixed
- Owned-number discovery now works for Linq WhatsApp, not only Linq. The WhatsApp channel declares its inventory and reply actions, both providers' differing response shapes are read, and rows are de-duplicated by id and address so a provider repeating an entry cannot inflate an inventory. Unknown provider health stays unknown: configuration, customer eligibility and delivery readiness remain separate facts.
- A credential mint refused before any request is sent no longer parks the order for operator review. The order already owns a billable number, and the key it was waiting on provably does not exist, so it stays retryable. An uncertain outcome after a request still parks exactly as before.

### Changed
- The decision to spend money is now taken in one place. Each provisioning phase asks the same lease for permission instead of repeating the in-flight, already-attempted and claim checks, so the ordering of those checks cannot drift between phases. Behaviour is unchanged and the existing tests were not modified.

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
