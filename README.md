# @tangle-network/agent-integrations

Integration infrastructure for agent products, sandbox apps, and generated
software.

Use this package when users connect external accounts and agents or apps need
controlled read/write access to those accounts. It gives products one stable
contract for connector discovery, OAuth/API-key connections, scoped sandbox
capabilities, action invocation, workflow triggers, approval, audit,
healthchecks, and provider/runtime adapters.

The product keeps ownership of UI, tenant policy, persistence, and secret
storage. `agent-integrations` keeps the runtime contract stable so generated
apps and agents do not depend on a specific OAuth broker, workflow vendor, or
provider SDK.

## Contents

- [What It Provides](#what-it-provides)
- [Architecture](#architecture)
- [Install](#install)
- [Quick Start](#quick-start)
- [Core Primitives](#core-primitives)
- [Catalog Registry](#catalog-registry)
- [Product Adoption](#product-adoption)
- [Provider Strategy](#provider-strategy)
- [Executable Coverage](#executable-coverage)
- [Product Hub Ownership](#product-hub-ownership)
- [Examples](#examples)
- [Security Model](#security-model)
- [Development](#development)

## What It Provides

- A normalized connector/action/trigger catalog.
- Tangle integration contracts for every catalog connector.
- User-owned connection records that reference secrets without storing raw
  credentials in public shapes.
- Short-lived capability tokens for sandbox-safe access to a subset of a user's
  connection.
- Policy checks for read/write/destructive actions.
- Invocation-envelope validation before sandbox tool calls reach the hub.
- A generic HTTP provider boundary for hosted integration gateways.
- A gateway catalog provider for hosted integration gateways, executor-style
  runtimes, and internal connector registries.
- A first-party `ConnectorAdapter` boundary for direct provider execution.
- A declarative REST adapter factory for promoting REST APIs from reviewed specs.
- A broad catalog for discovering hundreds of integrations while keeping
  executable backend state explicit.
- A canonical registry that deduplicates overlapping catalogs, keeps support
  tiers explicit, and reports auth/category conflicts.
- App/agent manifests, grants, and sandbox bundles so generated apps, domain
  agents, and executor-backed runtimes can reuse the same user-owned
  connections safely.
- Workflow trigger installation and normalized event dispatch for non-agent UI
  automation, sync jobs, webhooks, and product workflows.
- Approval persistence, audit events, healthchecks, credential resolution,
  webhook ingestion, idempotency guards, and sandbox/CLI bridge payloads.
- Generated-app client helpers, manifest inference/validation, consent copy,
  platform policy presets, canonical launch action schemas, and controlled
  provider-native passthrough validation.
- A generated `IntegrationSpec` registry used for setup docs, admin UI steps,
  normalized permissions, healthcheck plans, and tool descriptions.

## Architecture

```txt
connector contract
  -> user connection
  -> app/agent manifest
  -> grant
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

## Quick Start

```ts
import {
  buildDefaultIntegrationRegistry,
  buildIntegrationToolCatalog,
  createIntegrationRuntime,
  createPlatformIntegrationPolicyPreset,
  InMemoryConnectionStore,
  IntegrationHub,
} from '@tangle-network/agent-integrations'

const registry = buildDefaultIntegrationRegistry({
  tangleCatalogRuntimeExecutable: false,
})

const hub = new IntegrationHub({
  providers: [/* native, gateway, or catalog-runtime providers */],
  store: productConnectionStore ?? new InMemoryConnectionStore(),
  capabilitySecret: process.env.INTEGRATION_CAPABILITY_SECRET!,
  policy: createPlatformIntegrationPolicyPreset(),
})

const runtime = createIntegrationRuntime({
  hub,
  grants: productGrantStore,
})

const tools = buildIntegrationToolCatalog(registry.connectors)
```

For a generated app or sandbox:

```ts
const resolution = await runtime.resolveManifest(manifest, user)

if (resolution.missing.length > 0) {
  // Show connect UI using IntegrationSpec renderers.
}

await runtime.createGrants({
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

Generated code calls your product integration endpoint with the scoped
capability bundle. It never receives provider refresh tokens, API keys, or raw
OAuth credentials.

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
| `createIntegrationWorkflowRuntime` | Installs trigger workflows and dispatches normalized provider events. |
| `createApprovalBackedPolicyEngine` | Persists approval requests and allows approved invocations to resume. |
| `createDefaultIntegrationActionGuard` | Adds idempotency replay, dry-run mutation handling, rate-limit hooks, and audit events. |
| `createConnectionCredentialResolver` | Resolves secret refs into in-memory connector credentials and refreshes expired OAuth credentials. |
| `runIntegrationHealthchecks` | Checks connection status, registry executability, scope shape, and optional live provider tests. |
| `receiveIntegrationWebhook` | Verifies inbound webhooks, dedupes provider events, and dispatches normalized trigger events. |
| `buildIntegrationBridgeEnvironment` | Encodes scoped sandbox capabilities for sandbox processes or executor-style CLIs. |
| `createTangleIntegrationsClient` | Tiny generated-app/sandbox client for platform `/v1/integrations/invoke`. |
| `inferIntegrationManifestFromTools` / `validateIntegrationManifest` | Deterministic manifest helpers for Builder and platform APIs. |
| `renderConsentSummary` / `renderApprovalCopy` | User-facing consent and approval copy from manifests/actions. |
| `createPlatformIntegrationPolicyPreset` | Secure defaults: reads allowed after grant, writes need approval, destructive denied, passthrough disabled. |
| `buildCanonicalLaunchConnectors` | Product-ready launch action schemas for Calendar, Gmail, Drive, GitHub, and Slack. |
| `validateProviderPassthroughRequest` | Policy-gated provider-native HTTP escape hatch validation. |
| `buildIntegrationToolCatalog` | Converts connector actions into agent/tool definitions. |
| `searchIntegrationTools` | Intent search over normalized integration tools. |
| `buildDefaultIntegrationRegistry` | Composes setup specs and vendored catalog metadata into one deduplicated connector registry. |
| `composeIntegrationRegistry` | Merges arbitrary catalog sources with explicit aliases, precedence, support tiers, and conflict diagnostics. |
| `buildIntegrationCoverageConnectors` | Planning catalog for 100+ high-value integrations. |
| `buildTangleIntegrationCatalogConnectors` | Broad normalized Tangle Integrations Catalog inventory for long-tail connection discovery. |
| `listTangleIntegrationContracts` | First-class Tangle-owned action/trigger/auth/runtime contracts for every catalog connector, including package-runtime-backed entries. |
| `createTangleCatalogExecutorProvider` | Routes catalog contracts through an explicitly supplied Tangle runtime executor. |
| `createTangleCatalogHttpExecutor` | Signed HTTP executor client for Tangle-hosted catalog runtimes. |
| `createTangleCatalogRuntimeHandler` | Server-side `/v1/integration-catalog/actions/invoke` handler with signature, connector, and action validation. |
| `createTangleCatalogInstalledPackageExecutor` | Runtime-side dispatcher for installed long-tail connector packages with explicit action aliasing and credential resolution hooks. |
| `auditTangleCatalogRuntimePackages` | Runtime-image audit for installed package loads, piece exports, exact action mappings, and trigger surfaces. |
| `auditTangleIntegrationCatalogFreshness` | Release gate for catalog breadth, executable promotion, registry conflicts, and stale external ingestion. |
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

Every catalog connector has a Tangle contract. Native adapters, hosted gateways,
and package runtimes are implementation backends behind that contract; product
code should route through `IntegrationHub` either way.

Use `buildDefaultIntegrationRegistry()` before creating tool catalogs or
connection pickers. It produces one canonical connector per integration,
dedupes aliases such as `notion -> notion-database`, keeps source provenance in
metadata, and marks the configured execution state for each connector:

```txt
catalogOnly < setupReady < gatewayExecutable < firstPartyExecutable < sandboxExecutable
```

Use `buildDefaultIntegrationRegistry({ tangleCatalogRuntimeExecutable: true })`
when the Tangle catalog runtime is deployed and should be exposed as executable
tools. These states describe the backend currently wired into a product. They
do not change the connector contract.

See [Catalog Registry](./docs/catalog-registry.md).

## Product Adoption

Use `IntegrationManifest` for any app or agent that needs integrations:
generated apps, domain agents, sandbox agents, workflow apps, and
executor-backed runtimes all use the same shape.

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

Installed apps and published templates can bind to explicit pre-created grants:

```ts
const bundle = await runtime.buildSandboxBundle({
  grantIds: ['grant_calendar_read'],
  grantee: { type: 'app', id: installedAppId },
  subject: { type: 'sandbox', id: sandboxId },
  ttlMs: 15 * 60_000,
})
```

Generated apps and sandboxes receive scoped capability tokens and tool
definitions. They never receive OAuth refresh tokens, API keys, or raw secrets.
For sandbox processes, pass the bundle through `buildIntegrationBridgeEnvironment()`;
the payload contains short-lived capability tokens and tool names only.

Generated app code should use the tiny client instead of raw provider tokens:

```ts
const integrations = createTangleIntegrationsClient({
  endpoint: 'https://integrations.example.com',
  env: process.env,
})

await integrations.invoke({
  tool: 'google-calendar.events.list',
  input: { calendarId: 'primary', timeMin, timeMax },
})
```

The same manifest/grant model works for non-agent workflows:

```ts
await workflows.install({
  workflow,
  owner: user,
  grantee: { type: 'app', id: 'github-pr-sync' },
})
```

That installs provider trigger subscriptions against the user's connection and
lets the product dispatch normalized events to UI workflows, sync jobs, or
agent runs.

For a full product checklist, see
[External Product Integration](./docs/external-product-integration.md) and
[Platform Control Plane Adoption](./docs/platform-control-plane.md).

## Product Hub Ownership

Use a hosted hub when multiple apps intentionally share identity, billing,
consent, and connection custody. Use a product-owned hub when a standalone
deployment needs its own customer boundary, OAuth branding, vault, policy, or
data residency. Both modes use the same package contracts.

See [Product Hub Ownership](./docs/product-hub-ownership.md) for the
deployment model and launch gates.

## Provider Strategy

The package deliberately avoids vendor lock-in.

- Use a hosted gateway when it compresses long-tail OAuth/API coverage.
- Promote high-volume, sensitive, or strategically important integrations to
  first-party adapters.
- Keep product and sandbox code on `IntegrationHub` contracts so provider changes
  do not alter generated apps or agent tool calls.
- Treat catalog coverage and executable coverage as different states.

See [Provider Decision Matrix](./docs/provider-decision-matrix.md).
See [Integration Execution Audit](./docs/integration-execution-audit.md) for
the exact current split between catalog, setup, first-party execution, and
package-runtime execution.

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
- [`examples/calendar-exercise-app.ts`](./examples/calendar-exercise-app.ts) -
  generated-app golden path: manifest, consent copy, bridge env, and invoke.

The README stays short; examples are separate so they can be copied and expanded
without obscuring the package contract.

## Security Model

- Capability tokens expire.
- Capability tokens do not contain provider credentials.
- Connection records carry secret references, not raw secrets.
- Secret stores are consumer-pluggable; the package only resolves secret refs at
  call time and keeps raw credentials in memory.
- Write and destructive actions can require approval.
- Approval records are bound to the subject, connection, connector, and action.
- Default guards provide idempotency replay and same-key drift detection.
- Invocation envelopes validate action/tool consistency, idempotency keys,
  metadata shape, known tools, and input size.
- Webhook ingestion supports signature verification and provider-event dedupe.
- Provider-native passthrough is disabled by default and must be explicitly
  policy-enabled with method/path/body limits.
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
