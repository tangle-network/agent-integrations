# Provider Decision Matrix

Status date: 2026-05-04

`agent-integrations` should keep product code independent from any hosted
integration gateway, imported catalog source, executor-style service, or
first-party connector implementation. The strategic goal is not to outsource
integrations forever. The goal is to get broad connector coverage quickly while
preserving a clean path to bring important connectors in-house.

## Default Strategy

Use a three-tier connector strategy:

| Tier | Connector type | Default implementation | Why |
| --- | --- | --- | --- |
| Tier 1 | Strategic, high-volume, high-trust connectors | First-party provider adapter | Lowest unit cost, best UX, strictest security, strongest product moat. |
| Tier 2 | Common but non-core connectors | Hosted gateway behind `createHttpIntegrationProvider` | Fast coverage without leaking vendor APIs into apps or sandboxes. |
| Tier 3 | Long-tail and experimental connectors | Gateway or generated adapter | Cheap validation before committing engineering ownership. |

The invariant: every connector, no matter who backs it, must expose the same
`IntegrationConnector`, `IntegrationConnection`, action, trigger, and capability
contracts.

## Decision Matrix

Score each connector from 1 to 5. Higher total means stronger first-party
priority.

| Criterion | 1 | 3 | 5 |
| --- | --- | --- | --- |
| User demand | Rarely requested | Common in one vertical | Needed across many products/agents |
| Workflow criticality | Nice-to-have read path | Useful but recoverable | Blocks core product value |
| Data sensitivity | Public/low-risk | Private business data | Regulated, financial, legal, health, secrets |
| Write risk | Read-only | Reversible writes | Money movement, external comms, destructive writes |
| Volume/cost | Low call volume | Moderate calls | High volume where vendor margins matter |
| API stability | Messy/private/unstable | Usable but quirky | Stable official API + webhook model |
| Auth complexity | Simple API key | OAuth with refresh | Multi-tenant OAuth, domain-wide delegation, scoped installs |
| Product differentiation | Commodity | Some UX benefit | Better in-house UX is a moat |
| Vendor coverage quality | Vendor handles it well | Vendor has gaps | Vendor coverage is weak or too generic |
| Compliance/control need | Low | Moderate | Requires internal audit, retention, approval, residency controls |

Decision:

- `38+`: build or migrate first-party.
- `26-37`: start behind a gateway, schedule migration once usage proves out.
- `15-25`: keep gateway-backed unless a product launch depends on it.
- `<15`: do not build first-party yet; use long-tail gateway or defer.

## Practical Launch Order

Build first-party adapters first for connectors that are both broadly useful
and expensive/risky to delegate:

1. Gmail / Google Workspace mail
2. Google Calendar
3. Google Drive / Docs
4. Slack
5. Microsoft 365 mail/calendar/files
6. HubSpot
7. Salesforce
8. Notion
9. GitHub
10. Webhooks / generic HTTP actions

Use gateway-backed coverage for the next large tranche:

- marketing and ad platforms
- analytics tools
- project-management tools
- form tools
- storage services
- social networks
- long-tail CRM/support/helpdesk systems
- vendor-specific workflow triggers

This gives Agent Builder useful breadth immediately without forcing us to own
hundreds of OAuth apps, refresh-token edge cases, webhook subscription models,
rate-limit policies, and provider-specific APIs on day one.

## When To Roll Our Own

Move a connector first-party when one of these is true:

- It appears in multiple product launch paths.
- It is needed by generated sandbox apps, not just back-office automation.
- Users expect a polished native UX for connection, approval, and failure
  recovery.
- The action volume makes gateway pricing materially worse than internal
  maintenance.
- The connector touches high-trust data or irreversible writes.
- We need better replay, idempotency, audit, or conflict handling than a vendor
  exposes.
- The vendor abstraction hides too much provider-specific capability.
- We need to publish open-source agent apps that still reliably route through
  our platform keys, sandboxes, and audit controls.

## When To Use A Gateway

Use a gateway when speed and breadth matter more than deep ownership:

- The connector is long-tail or unproven.
- The integration is read-only or low write-risk.
- The provider API is annoying but not strategic.
- The product team needs a demo or beta connector this week.
- The connector is mainly a trigger source, not a rich bidirectional app API.
- The connector is expected to churn while the product shape is still moving.

Gateways are acceptable only behind `IntegrationProvider`. Product code must
not import vendor SDKs or depend on vendor-specific connection records.

## First-Party Adapter Requirements

A first-party connector is not just a thin API wrapper. It must ship with:

- normalized connector manifest
- OAuth/API-key start and complete flows
- encrypted token/secret reference handling
- refresh-token and expiry handling
- action schemas and output schemas
- trigger subscription and normalization if supported
- provider rate-limit and retry policy
- typed errors that agents can recover from
- `IntegrationActionGuard` compatibility for idempotency, audit, approval, and
  conflict handling
- tests that cover auth, scope denial, capability denial, provider errors, and
  write approval paths

## Guard Policy

Every production hub should install an `IntegrationActionGuard`.

The guard is where products enforce cross-provider discipline:

- idempotency key replay
- same-key-different-args rejection
- human approval before risky writes
- per-tenant and per-connection rate limits
- audit logging
- conflict detection
- dry-run handling
- structured alternatives when an action cannot safely run

Providers should execute actions. Guards should decide whether an action may
run, whether it has already run, and how to record it.

## The Cheap Path

The cheapest credible path is:

1. Keep `agent-integrations` as the stable SDK contract.
2. Use a hosted gateway for broad catalog coverage while demand is uncertain.
3. Route every sandbox/app action through short-lived capabilities and a guard.
4. Instrument connector usage, error rate, action volume, and approval friction.
5. Promote the highest-scoring connectors to first-party adapters.
6. Keep long-tail connectors gateway-backed until usage justifies ownership.

This avoids two bad extremes:

- locking the product into a vendor abstraction that becomes expensive and
  limiting;
- cloning hundreds of integrations before knowing which ones matter.
