# Agent Integrations Execution Layer Launch Plan

## Goal

Make `agent-integrations` the shared execution layer for Tangle products, generated sandbox apps, and agents that need external systems.

The package should own the stable product contract for:

- connector catalog and tool discovery
- user/team-owned connections
- OAuth/API-key/HMAC connection flows
- short-lived sandbox-safe capabilities
- policy checks and approval gates
- action execution
- trigger/webhook normalization
- MCP/tool export surfaces
- first-party and vendor-backed provider adapters

The product value is direct: a user can ask Agent Builder to create an app that uses Gmail, Slack, Calendar, HubSpot, Stripe, Notion, or a webhook; the app can request the right connections; the sandbox receives only scoped capabilities; and every read, write, trigger, and approval is auditable.

## Current Status

Shipped:

- vendor-neutral `IntegrationHub`
- connection store contract
- short-lived signed capabilities
- action invocation with scope/action checks
- `IntegrationActionGuard` hook for idempotency, audit, rate limits, and approvals
- generic HTTP provider adapter for hosted gateways
- OAuth helper
- webhook signature helpers
- first-party adapter contracts
- first-party adapters for Google Calendar, Google Sheets, Microsoft Calendar, HubSpot, Slack, Notion, Twilio SMS, Stripe, generic webhooks, Slack events, and Stripe webhooks
- adapter manifest contract tests

Missing for full launch:

- typed, searchable tool catalog that agents can query by intent
- canonical policy engine with approval decisions, not only a hook
- approval request/result types and helpers
- MCP/tool-call export helpers
- runtime invocation envelope for sandboxes
- connection requirement planning for generated apps
- provider import pipeline for OpenAPI/GraphQL/MCP catalogs
- first-party provider registry that wraps `ConnectorAdapter[]` into `IntegrationProvider`
- live provider smoke tests for top connectors
- security hardening gates for secret redaction, scope minimization, replay, and writes

## Architecture Target

```txt
Generated app / agent / sandbox
  -> Integration tool catalog search
  -> connection requirements
  -> user connects provider account
  -> capability issued for sandbox/session
  -> policy engine decides allow / approve / deny
  -> action executor calls first-party or vendor-backed provider
  -> audit event emitted
  -> trigger receiver wakes sandbox workflows
```

`agent-integrations` owns contracts and reusable enforcement. Product repos own UI, tenant policy, persistence, and provider credentials.

## Tactical PR Sequence

### PR 1: Execution Plan

- Add this tracking doc.

Exit criteria:

- The repo has a durable, concrete launch map.

### PR 2: Catalog Search and Tool Export

- Add `IntegrationToolDefinition`.
- Add `buildIntegrationToolCatalog(connectors)`.
- Add `searchIntegrationTools(catalog, query, filters)`.
- Add `integrationToolName(providerId, connectorId, actionId)`.
- Add `parseIntegrationToolName(name)`.
- Add MCP-compatible tool export shape.

Exit criteria:

- Agents can discover tools by intent instead of stuffing every schema into context.
- Tool names round-trip deterministically to provider/connector/action.

### PR 3: Policy Engine and Approvals

- Add `IntegrationPolicyRule`.
- Add `IntegrationPolicyEngine`.
- Add decision states: `allow`, `require_approval`, `deny`.
- Add approval artifact types: `IntegrationApprovalRequest`, `IntegrationApprovalResolution`.
- Add default policy: reads allowed, writes require approval by default, destructive denied unless explicitly allowed.

Exit criteria:

- Product apps can enforce a consistent approval boundary before any external write.
- Policy decisions include reasons and audit-safe metadata.

### PR 4: Sandbox Invocation Envelope

- Add `IntegrationInvocationEnvelope`.
- Add helper to build a sandbox-safe invocation request from a capability and tool call.
- Add redaction helpers for logs/events.
- Add action result normalization for conflict/rate-limit/approval states.

Exit criteria:

- Sandboxes can invoke integrations without ever receiving reusable provider credentials.

### PR 5: First-Party Provider Registry

- Add `createConnectorAdapterProvider`.
- Convert `ConnectorAdapter` manifests into `IntegrationConnector` catalog entries.
- Route read/mutation calls to adapter methods.
- Enforce capability class alignment and idempotency key defaults.

Exit criteria:

- The shipped first-party adapters become directly usable through `IntegrationHub`.

### PR 6: Catalog Importers

- Add source importer contracts for OpenAPI, GraphQL, and MCP catalogs.
- Add manifest normalization helpers.
- Add license-safe notes for importing MIT/open catalogs and deriving patterns from restricted-license systems.

Exit criteria:

- We can mine open-source catalogs and API specs without making product code vendor-shaped.

### PR 7: Launch Smoke Tests

- Add live-test harness contracts with environment-gated tests.
- Cover OAuth start/complete where practical.
- Cover reads, writes, approval-required writes, webhook verification, replay rejection, and scope denial.

Exit criteria:

- Top connectors have real non-mocked verification paths before public launch.

## First Provider Priorities

Tier 1 first-party:

- Gmail
- Google Calendar
- Slack
- GitHub
- Notion
- Stripe
- HubSpot
- Airtable
- Microsoft Calendar / Outlook
- Linear

Tier 2 first-party or vendor-backed:

- Google Sheets
- Google Drive
- Salesforce
- Zendesk
- Intercom
- Jira
- Asana
- Trello
- Resend
- Twilio
- Supabase
- Postgres

Long tail:

- Import from OpenAPI/GraphQL/MCP catalogs.
- Use vendor-backed providers only as coverage accelerators.
- Promote high-volume or high-trust integrations to first-party.

## OSS Mining Policy

Use permissively licensed projects aggressively, especially MIT and Apache-2.0.

Allowed:

- copy, fork, or port license-compatible code with attribution
- import connector definitions and catalog structure
- reuse MCP bridge and policy patterns where license permits
- derive architecture lessons from any public repo

Not allowed without explicit legal/product decision:

- copying restricted-license source into this package
- inheriting a vendor's auth, storage, tenancy, or billing model as our product contract
- exposing provider secrets to generated apps or sandboxes

Executor-style systems are priority inspiration for catalog, policy, MCP, and local/dev ergonomics. Nango-style systems are useful for OAuth, sync, and provider quirks, but restricted-license source should be treated as reference material rather than vendored code.

## Launch Gate Checklist

- [ ] Tool catalog search works over first-party and imported tools.
- [ ] MCP-compatible tool export is stable.
- [ ] Default policy engine gates writes and destructive actions.
- [ ] Approval artifacts are typed and audit-safe.
- [ ] Sandbox invocation envelope never contains provider credentials.
- [ ] First-party adapters are callable through `IntegrationHub`.
- [ ] Webhook receivers verify signatures and reject replay where provider supports timestamps.
- [ ] Redaction helper covers connections, capabilities, approvals, and invocation logs.
- [ ] Agent Builder can declare required connectors from generated app specs.
- [ ] Agent Builder can ask users to connect missing accounts.
- [ ] Agent Builder can pass scoped capabilities to generated sandbox apps.
- [ ] Generated sandbox apps can call integrations through the runtime envelope.
- [ ] Human approval flow exists for writes.
- [ ] Top provider live smoke tests are documented and environment-gated.
- [ ] Package README explains the concrete product UX, not only abstractions.

## Definition Of Done

The package is launch-ready when Agent Builder can generate an app that needs at least Gmail, Slack, Calendar, or Stripe; the user can connect the account; the app runs in a sandbox with a scoped capability; reads execute without extra user friction; writes pause for approval; triggers can wake workflows; and every step is observable without leaking secrets.
