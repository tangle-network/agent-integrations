# Integration Hub Ownership

Status: deployment guidance

This document describes where integration custody should live when a product
uses `@tangle-network/agent-integrations`.

## Decision

Use one contract everywhere, not one deployment everywhere.

- Products that share identity, billing, and consent can use a hosted platform
  hub.
- Standalone products can run a product-owned hub.
- Both modes must use `@tangle-network/agent-integrations` contracts:
  `IntegrationSpec`, `IntegrationManifest`, `IntegrationGrant`, capability
  bundles, `/v1/integrations/invoke`, approvals, healthchecks, audit, webhooks,
  and provider/runtime adapters.
- Product-owned hubs may federate to a hosted platform hub when the deployment
  wants a shared connection wallet.

The package defines the shared protocol. Each deployment decides where to store
connections, secrets, grants, approvals, audit records, and workflow state.

## Ownership Modes

| Mode | Use When | Owns OAuth, Vault, Audit | Invocation Path |
|---|---|---:|---|
| Hosted platform hub | Multiple apps share account, consent, billing, and connection custody | Platform service | App/sandbox calls platform hub or product proxy with scoped capability |
| Product-owned hub | Standalone SaaS, private deployment, or customer-owned data boundary | Product app | App/sandbox calls product `/v1/integrations/invoke` |
| Federated product hub | Product wants local policy with remote connection custody | Product policy + hosted custody | Product issues local grants over remote platform connections |

The important invariant: sandboxes and generated apps never receive provider
refresh tokens, API keys, or raw OAuth credentials in any mode.

## Where Duplication Is Bad

Fully duplicating hubs is bad when apps are intentionally part of the same
account system:

- Users reconnect Gmail, Slack, GitHub, and Drive in every app.
- OAuth app verification, scopes, redirect configuration, and consent review
  are repeated.
- Revocation, audit, healthchecks, and billing attribution fragment.
- Generated apps cannot inherit a user's already-approved connection.

For those deployments, use a hosted hub as the connection source of truth and
pass scoped grants down to apps, sandboxes, and agents.

## Where Centralization Is Bad

Forcing every deployment through a hosted platform hub is bad when the product
needs a separate customer, compliance, or operational boundary:

- The buyer may not want shared identity or billing in their end-user flow.
- Enterprise deployments may require product-branded OAuth apps, product-owned
  vaults, customer-managed keys, private networking, or data residency.
- Product-specific subscriptions and compliance boundaries may not match the
  platform account model.
- A central platform outage should not necessarily take down a standalone app.

For those products, run a product-owned hub using the same package contracts.
Optionally add federation to a hosted platform hub as a deployment choice.

## Execution Checklist

- [x] One stable contract for specs, manifests, grants, capabilities, invocation,
      approvals, healthchecks, webhooks, audit, and bridge payloads.
- [x] Long-tail connector contracts and runtime-backed execution path are
      represented without leaking external catalog names into product UX.
- [x] External product adoption guide documents product-owned deployment.
- [x] This ownership decision documents platform versus product-owned custody.

### Hosted Hub Bar

- [ ] The hosted hub has production stores for connections, grants, approvals,
      audit, healthchecks, workflows, webhook events, and idempotency.
- [ ] The hosted hub vault/KMS stores raw OAuth/API-key credentials behind
      secret refs.
- [ ] The hosted hub exposes connect, callback, revoke, rotate, approve, audit,
      healthcheck, and `/v1/integrations/invoke`.
- [ ] Sandbox and generated-app launches receive
      `buildIntegrationBridgeEnvironment()` output.
- [ ] Browser E2E covers connect, consent, preview, invoke read, approval write,
      revoke, expired token recovery, and missing-connection recovery.

### Product-Owned Hub Bar

- [ ] The product chooses local hub or federated platform hub per deployment.
- [ ] Local hubs use `IntegrationHub`; custom provider switch statements are
      removed or wrapped as `IntegrationProvider` implementations.
- [ ] The product stores connections, grants, approvals, audit, healthchecks,
      workflows, events, and idempotency in its own database.
- [ ] The product uses its own vault/KMS or explicitly delegates secret custody
      to a hosted hub.
- [ ] The product has live OAuth/API-key setup UI generated from
      `IntegrationSpec`.
- [ ] The product has browser E2E personas using real product UX and live
      integration secrets where available.

## Product E2E Gates

Run these before launch for every product adopting integrations:

1. Existing connection: user asks for a task requiring Gmail, Calendar, Slack,
   GitHub, Drive, Sheets, or CRM data; agent detects the existing connection and
   uses it without asking for manual copy/paste.
2. Missing connection: user asks for the same task without a connection; product
   renders connect/consent in flow, resumes the task after OAuth, and does not
   lose conversation state.
3. Generated app preview: generated software declares an
   `IntegrationManifest`; preview requests user consent, receives scoped
   capabilities, and reads provider data through the invoke endpoint.
4. Write approval: generated app or agent proposes a write/send/update action;
   product requires approval, records audit, and executes once with idempotency.
5. Revocation: user revokes a connection; existing grants fail closed and the UI
   explains how to reconnect.
6. Healthcheck failure: expired or revoked upstream credentials surface in admin
   UI and task UX without exposing secrets in logs or traces.

## Recommendation

Do not fork integration semantics by product. Make hub custody a deployment
choice while keeping the protocol stable. Hosted hubs, product-owned hubs, and
federated hubs should all expose the same manifest, grant, capability, approval,
audit, webhook, and invocation shapes.
