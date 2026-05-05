# @tangle-network/agent-integrations

Vendor-neutral integration contracts for agent apps, sandboxes, and generated
software that need user-authorized access to external systems.

The package standardizes connector catalogs, user connections, scoped sandbox
capabilities, action invocation, trigger events, provider adapters, and
first-party connector adapters. Product code can route through Nango, Pipedream,
Activepieces, a custom gateway, or first-party adapters without changing the
agent-facing tool contract.

## Contents

- [What It Provides](#what-it-provides)
- [Architecture](#architecture)
- [Install](#install)
- [Core Primitives](#core-primitives)
- [Catalog Registry](#catalog-registry)
- [Provider Strategy](#provider-strategy)
- [Executable Coverage](#executable-coverage)
- [Examples](#examples)
- [Security Model](#security-model)
- [Development](#development)

## What It Provides

- A normalized connector/action/trigger catalog.
- User-owned connection records that reference secrets without storing raw
  credentials in public shapes.
- Short-lived capability tokens for sandbox-safe access to a subset of a user's
  connection.
- Policy checks for read/write/destructive actions.
- Invocation-envelope validation before sandbox tool calls reach the hub.
- A generic HTTP provider boundary for hosted integration gateways.
- A gateway catalog provider for Nango, Pipedream, Activepieces, Zapier,
  executor-style gateways, and internal connector registries.
- A first-party `ConnectorAdapter` boundary for direct provider execution.
- A declarative REST adapter factory for promoting REST APIs from reviewed specs.
- A broad coverage catalog for planning hundreds of integrations without
  pretending every catalog item is executable.
- A canonical registry that deduplicates overlapping catalogs, keeps support
  tiers explicit, and reports auth/category conflicts.
- App/agent manifests, grants, and sandbox bundles so Builder, generated apps,
  vertical agents, Blueprint Agent, and executor-backed runtimes can reuse the
  same user-owned connections safely.
- A generated `IntegrationSpec` registry used for setup docs, admin UI steps,
  normalized permissions, healthcheck plans, and tool descriptions.

## Architecture

```txt
connector catalog
  -> user connection
  -> scoped capability
  -> policy decision
  -> provider/action invocation
  -> audit-safe result or normalized trigger event
```

Main boundaries:

- `IntegrationHub`: product-facing facade for catalogs, connections,
  capabilities, and action invocation.
- `IntegrationProvider`: vendor or gateway implementation boundary.
- `ConnectorAdapter`: first-party connector boundary for direct API execution.
- `IntegrationActionGuard`: optional cross-cutting hook for idempotency,
  approval, audit logging, rate limits, and conflict handling.

## Install

```sh
pnpm add @tangle-network/agent-integrations
```

## Core Primitives

| Primitive | Purpose |
|---|---|
| `IntegrationConnector` | Normalized catalog entry for a provider connection. |
| `IntegrationConnection` | User/team/agent-owned grant with scopes and secret references. |
| `IntegrationHub` | Facade for provider catalogs, connection storage, capabilities, and invocation. |
| `IntegrationCapability` | Short-lived authorization for a specific subject, connection, scope set, and action set. |
| `IntegrationManifest` | Generated app or agent requirements: connectors, actions, scopes, and reasons. |
| `IntegrationGrant` | Persistent grant from a user-owned connection to an app, agent, or sandbox consumer. |
| `createIntegrationRuntime` | Facade for manifest resolution, grant creation, and sandbox capability bundles. |
| `buildIntegrationToolCatalog` | Converts connector actions into agent/tool definitions. |
| `searchIntegrationTools` | Intent search over normalized integration tools. |
| `buildDefaultIntegrationRegistry` | Composes setup specs and vendored catalog metadata into one deduplicated connector registry. |
| `composeIntegrationRegistry` | Merges arbitrary catalog sources with explicit aliases, precedence, support tiers, and conflict diagnostics. |
| `buildIntegrationCoverageConnectors` | Planning catalog for 100+ high-value integrations. |
| `createGatewayCatalogProvider` | Normalizes 500+ gateway-backed connectors into the same provider contract. |
| `buildIntegrationInvocationEnvelope` | Sandbox-safe action envelope. |
| `validateIntegrationInvocationEnvelope` | Runtime validation for tool/action consistency and input limits. |
| `createHttpIntegrationProvider` | Adapter for hosted integration gateways. |
| `createConnectorAdapterProvider` | Runs first-party `ConnectorAdapter`s through the same provider contract. |
| `declarativeRestConnector` | Builds REST-backed first-party adapters from compact specs. |
| `listIntegrationSpecs` | Generates setup/execution specs from the coverage catalog and family defaults. |
| `renderRunbookMarkdown` / `renderConsoleSteps` | Render operator docs or admin UI steps from the same spec source. |
| `validateCredentialSet` / `buildHealthcheckPlan` | Validate setup input and describe the correct healthcheck path. |

## Catalog Registry

Catalog breadth and runtime execution are separate. Activepieces metadata gives
the package broad connector inventory; first-party adapters and gateways decide
which connectors can actually run.

Use `buildDefaultIntegrationRegistry()` before creating tool catalogs or
connection pickers. It produces one canonical connector per integration,
dedupes aliases such as `notion -> notion-database`, keeps source provenance in
metadata, and marks each connector with a support tier:

```txt
catalogOnly < setupReady < gatewayExecutable < firstPartyExecutable < sandboxExecutable
```

See [Catalog Registry](./docs/catalog-registry.md).

## App And Agent Grants

Use `IntegrationManifest` for any app or agent that needs integrations:
Agent Builder-generated apps, tax/legal/GTM/creative agents, Blueprint Agent
sandboxes, and executor-backed workflows all use the same shape.

```ts
const runtime = createIntegrationRuntime({ hub, grants })

const resolution = await runtime.resolveManifest(manifest, user)
const grants = await runtime.createGrants({
  manifest,
  owner: user,
  grantee: { type: 'app', id: manifest.id },
})
const bundle = await runtime.buildSandboxBundle({
  manifestId: manifest.id,
  subject: { type: 'sandbox', id: sandboxId },
  ttlMs: 15 * 60_000,
})
```

Generated apps and sandboxes receive scoped capability tokens and tool
definitions. They never receive OAuth refresh tokens, API keys, or raw secrets.

## Provider Strategy

The package deliberately avoids vendor lock-in.

- Use a hosted gateway when it compresses long-tail OAuth/API coverage.
- Promote high-volume, sensitive, or strategically important integrations to
  first-party adapters.
- Keep product and sandbox code on `IntegrationHub` contracts so provider changes
  do not alter generated apps or agent tool calls.
- Treat catalog coverage and executable coverage as different states.

See [Provider Decision Matrix](./docs/provider-decision-matrix.md).

## Executable Coverage

Current first-party adapters:

- Google Calendar
- Microsoft Calendar
- Google Sheets
- Slack
- Slack Events
- HubSpot
- Notion database
- Stripe payments pack
- Stripe webhook receiver
- Twilio SMS
- Generic webhook
- GitHub
- GitLab
- Airtable
- Asana
- Salesforce

Broad planning coverage is generated from
`buildIntegrationCoverageConnectors()` and tracked in
[Integration Coverage Checklist](./docs/integration-coverage-checklist.md).

## Examples

Runnable examples live in [`examples/`](./examples):

- [`examples/basic-hub.ts`](./examples/basic-hub.ts) - catalog search,
  connection storage, capability issue, and action invocation.
- [`examples/first-party-adapter.ts`](./examples/first-party-adapter.ts) -
  first-party adapter provider wiring.
- [`examples/declarative-rest.ts`](./examples/declarative-rest.ts) - compact
  REST connector spec.

The README stays short; examples are separate so they can be copied and expanded
without obscuring the package contract.

## Security Model

- Capability tokens expire.
- Capability tokens do not contain provider credentials.
- Connection records carry secret references, not raw secrets.
- Write and destructive actions can require approval.
- Invocation envelopes validate action/tool consistency, idempotency keys,
  metadata shape, known tools, and input size.
- Action invocation checks ownership, connection status, scopes, allowed actions,
  and expiration.
- `IntegrationActionGuard` can enforce idempotency, approval, audit logging,
  conflict handling, and rate limits across all providers.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
