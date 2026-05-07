# External Product Integration

This guide is for product teams using `@tangle-network/agent-integrations`
outside this repository. The package gives you stable contracts and runtime
helpers; your product supplies persistence, secret storage, UI, and deployment
policy.

## Mental Model

```txt
user connects account
  -> product stores IntegrationConnection + secret refs
  -> app/agent declares IntegrationManifest
  -> product creates IntegrationGrant
  -> sandbox/app receives short-lived capability bundle
  -> sandbox/app invokes product /integrations/invoke endpoint
  -> IntegrationHub validates capability, policy, approval, idempotency
  -> provider backend executes action
  -> product stores audit event and returns normalized result
```

The invariant: generated apps and agents call the same Tangle integration tools
no matter whether a connector is backed by a native adapter, hosted gateway, or
catalog runtime.

## Product-Owned Pieces

You must provide:

- `IntegrationConnection` storage in your database.
- `IntegrationGrant` storage mapping user-owned connections to apps, agents, or
  sandboxes.
- Approval, audit, healthcheck, workflow, and event stores.
- `IntegrationSecretStore` backed by your vault or KMS.
- OAuth/API-key connect UI built from `IntegrationSpec` renderers.
- Tenant policy for which connectors are enabled.
- Human approval UX for write/destructive actions.
- A deployed invocation endpoint such as `/v1/integrations/invoke`.

The package provides interfaces and helpers for all of these. It does not store
your secrets or run your product UI.

## Setup Flow

1. Build the registry.

```ts
import { buildDefaultIntegrationRegistry } from '@tangle-network/agent-integrations'

const registry = buildDefaultIntegrationRegistry({
  tangleCatalogRuntimeExecutable: process.env.TANGLE_CATALOG_RUNTIME === '1',
})
```

2. Render setup UI from specs.

```ts
import {
  listIntegrationSpecs,
  renderConsoleSteps,
  validateCredentialSet,
} from '@tangle-network/agent-integrations'

const spec = listIntegrationSpecs().find((candidate) => candidate.kind === 'google-calendar')
const steps = renderConsoleSteps(spec!, { host: 'id.example.com' })
const validation = validateCredentialSet(spec!, submittedCredentials)
```

3. Store provider credentials in your vault, then persist an
   `IntegrationConnection` with secret refs, scopes, owner, connector id, and
   status.

4. Run `runIntegrationHealthchecks()` after setup and on a schedule.

## Runtime Flow

Create one hub per product runtime.

```ts
import {
  createConnectorAdapterProvider,
  createDefaultIntegrationActionGuard,
  IntegrationHub,
  createPlatformIntegrationPolicyPreset,
} from '@tangle-network/agent-integrations'

const hub = new IntegrationHub({
  providers: [
    createConnectorAdapterProvider({
      adapters,
      resolveDataSource: (connection) => credentialResolver.resolve(connection),
    }),
    // createHttpIntegrationProvider(...) or createTangleCatalogExecutorProvider(...)
  ],
  store: connections,
  capabilitySecret: process.env.INTEGRATION_CAPABILITY_SECRET!,
  policy: createPlatformIntegrationPolicyPreset(),
  guard: createDefaultIntegrationActionGuard({
    audit,
    idempotency,
  }),
})
```

Your `/v1/integrations/invoke` route should:

1. Parse the invocation envelope.
2. Validate the capability token.
3. Resolve the user's connection and credentials.
4. Run policy and approval checks.
5. Execute through the matching provider.
6. Store an audit event.
7. Return a normalized result or `approval_required`.

## Generated Apps And Sandboxes

Generated apps declare needs through `IntegrationManifest`.

```ts
const manifest = {
  id: 'calendar-workout-planner',
  requirements: [
    {
      connectorId: 'google-calendar',
      mode: 'read',
      reason: 'Find open workout windows from calendar events.',
      requiredActions: ['events.list'],
      scopes: ['calendar.read'],
    },
  ],
}
```

When a user previews or installs the app:

1. Resolve the manifest against the user's existing connections.
2. Ask the user to connect missing accounts.
3. Show consent using `renderConsentSummary()`.
4. Create grants from the user's connections to the app.
5. Build a sandbox bundle with short-lived capabilities.
6. Inject the bridge environment into the sandbox.

Generated app code should use `createTangleIntegrationsClient()` or the product
equivalent. It should not call Google, Slack, GitHub, or any provider directly
with user credentials.

## Workflows And Triggers

Use `createIntegrationWorkflowRuntime()` for non-agent automations:

- GitHub issue or pull-request sync.
- Slack message triggers.
- Calendar event updates.
- CRM record changes.
- Webhook-to-sandbox workflows.

Inbound provider webhooks should go through `receiveIntegrationWebhook()` for
signature verification, provider-event dedupe, and normalized event dispatch.

## Long-Tail Connectors

The registry distinguishes connector contracts from executable backend state.
Products can expose long-tail connectors only when they have configured a
backend:

- native adapter
- hosted integration gateway
- Tangle catalog runtime
- product-specific provider

Use `buildDefaultIntegrationRegistry({ tangleCatalogRuntimeExecutable: true })`
only after the catalog runtime is deployed and audited with
`auditTangleCatalogRuntimePackages()`.

## Security Requirements

- Never pass provider refresh tokens or API keys into a sandbox.
- Use short-lived capability tokens scoped to connector, action, subject, and
  connection.
- Require approval for writes by default.
- Deny destructive actions unless the product explicitly enables them.
- Use idempotency keys for state-changing actions.
- Store audit events for connect, grant, invoke, approve, revoke, rotate, and
  webhook flows.
- Redact provider credentials from logs, traces, errors, and generated app
  payloads.

## Launch Checklist

- [ ] Connection, grant, approval, audit, healthcheck, workflow, and event stores
      are backed by production persistence.
- [ ] Secret refs resolve through vault/KMS and never serialize raw credentials.
- [ ] OAuth/API-key setup UI renders from `IntegrationSpec`.
- [ ] Connect, revoke, rotate, approve, and audit-log screens exist.
- [ ] Generated app manifests feed into `resolveManifest()` and
      `createGrants()`.
- [ ] Sandbox launches receive `buildIntegrationBridgeEnvironment()` output.
- [ ] Sandbox invocations route through your product integration endpoint.
- [ ] Writes require approval and idempotency.
- [ ] Webhooks verify signatures and dedupe provider event ids.
- [ ] Healthchecks run after setup and on a schedule.
- [ ] Browser E2E covers connect, consent, preview, invoke, approval, revoke,
      and failure recovery.
