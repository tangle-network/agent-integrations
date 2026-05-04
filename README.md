# Agent Integrations

`@tangle-network/agent-integrations` is a vendor-neutral integration layer for
apps, sandboxes, and agents that need user-authorized connections such as email,
calendar, Slack, CRM, storage, webhooks, and workflow triggers.

The package does not pick a single integration vendor. Nango, Pipedream,
Zapier-style platforms, Activepieces, executor services, and first-party
connectors should all sit behind the same provider interface.

## Mental Model

```txt
Connector catalog -> User connection -> Scoped capability -> Action or trigger
```

- **Connectors** describe what can be connected: Gmail, Google Calendar, Slack,
  HubSpot, webhooks, internal tools.
- **Connections** are user/team-owned grants. They carry secret references, not
  raw credentials.
- **Capabilities** are short-lived, sandbox-safe tokens that authorize a subset
  of actions on a connection.
- **Actions** are read/write/destructive operations.
- **Triggers** normalize inbound events from providers into one event shape.

## Why This Exists

Agent Builder and sandbox apps need to support prompts like:

```txt
At Gmail, build me an app that summarizes unread support emails and drafts replies.
```

The generated app should be able to request Gmail access, instantiate inside the
user's sandbox, and let the agent read/write through a scoped integration
capability. The sandbox should never receive reusable provider secrets.

## Core Usage

```ts
import {
  InMemoryConnectionStore,
  IntegrationHub,
  createMockIntegrationProvider,
} from '@tangle-network/agent-integrations'

const hub = new IntegrationHub({
  providers: [createMockIntegrationProvider()],
  store: new InMemoryConnectionStore(),
  capabilitySecret: 'dev-secret',
})

const connection = await hub.upsertConnection({
  id: 'conn_1',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'mock',
  connectorId: 'gmail',
  status: 'active',
  grantedScopes: ['email.read'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const capability = await hub.issueCapability({
  subject: { type: 'sandbox', id: 'sandbox_1' },
  connectionId: connection.id,
  scopes: ['email.read'],
  allowedActions: ['messages.search'],
  ttlMs: 60_000,
})

const result = await hub.invokeWithCapability(capability.token, {
  action: 'messages.search',
  input: { q: 'is:unread' },
})
```

## Provider Boundary

Providers implement OAuth, action execution, and optional triggers. Product code
should depend on `IntegrationHub`, not on a vendor SDK.

Provider adapters are expected to store raw credentials in their own secure
vault or return secret references. Connection records should remain safe to log
after sanitization.

For a hosted integration gateway, use the generic HTTP adapter:

```ts
import { createHttpIntegrationProvider } from '@tangle-network/agent-integrations'

const provider = createHttpIntegrationProvider({
  id: 'gateway',
  kind: 'pipedream',
  baseUrl: 'https://integrations.example',
  bearer: process.env.INTEGRATION_GATEWAY_TOKEN,
  connectors: [/* normalized connector catalog */],
})
```

The HTTP adapter keeps product code stable while the backing provider can be
Nango, Pipedream, Activepieces, a Zapier-style service, or an internal gateway.

See [Provider Decision Matrix](./docs/provider-decision-matrix.md) for the
build-vs-buy policy. The short version: use a vendor gateway only to compress
time-to-coverage, but keep all product and sandbox code on this package's
contracts so high-volume or strategic connectors can be moved first-party
without changing agent code.

## Security Defaults

- Capabilities expire.
- Capability tokens contain no provider credential.
- Secret refs are redacted from public telemetry.
- Write/destructive actions can be policy-gated.
- Action invocation checks connection ownership, status, scopes, allowed
  actions, and expiration.
- Optional `IntegrationActionGuard` wraps every action invocation for
  idempotency, audit logging, conflict detection, rate limits, and
  approval gates.
