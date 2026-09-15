# Changelog

## Unreleased

### Added
- `@tangle-network/agent-integrations/tangle-search`: typed Router search client and
  request/response helpers. Provider-neutral, explicit host credentials, request
  correlation, unknown-cost preservation, cancellation and bounded JSON reads.
- `@tangle-network/agent-integrations/twilio`: managed phone verification, correlated
  SMS receipts, native form-webhook authentication and phone normalization.
- `createTwilioWebhookProvider` in the existing `/webhooks` entrypoint. Uses the
  existing replay/delivery router; delivery statuses have distinct event identities.

No new agent loop, evaluator, enrollment database, session store, provider registry,
or dependency was introduced. These are additive APIs; existing connectors and
exports are unchanged. Form signatures do not themselves prevent replay and no
client automatically retries an uncertain message or a billable search.

Migration and validation: [host-search-and-phone](docs/host-search-and-phone.md).
Release versions remain owned by the existing release workflow.
