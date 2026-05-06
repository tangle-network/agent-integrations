# Catalog Registry

`agent-integrations` can ingest several catalog sources:

- first-party adapters
- generated setup specs
- gateway catalogs
- imported Tangle Integrations Catalog metadata
- planning coverage stubs

Those sources intentionally overlap. The public product surface should not.
Use `composeIntegrationRegistry()` or `buildDefaultIntegrationRegistry()` before
building agent tools, connection pickers, setup flows, or planning context.

## Support Tiers

The registry assigns one tier per canonical connector:

| Tier | Meaning |
| --- | --- |
| `catalogOnly` | Has a Tangle connector contract, but this registry was not built with an execution provider for it. |
| `setupReady` | Has setup/auth/spec metadata, but this registry was not built with an execution provider for it. |
| `gatewayExecutable` | Executable through a gateway provider. |
| `firstPartyExecutable` | Executable through a first-party adapter. |
| `sandboxExecutable` | Safe to invoke directly from generated sandbox apps. |

These tiers describe the provider wired into this registry, not connector
importance or contract completeness.

Provider selection order is explicit:

```txt
sandboxExecutable
  > firstPartyExecutable
  > gatewayExecutable
  > setupReady
  > catalogOnly
```

When multiple catalogs define the same integration, the registry keeps one
canonical connector, retains source provenance, merges non-conflicting
actions/triggers, and reports auth/category conflicts.

## Example

```ts
import {
  buildDefaultIntegrationRegistry,
  buildIntegrationToolCatalog,
  searchIntegrationTools,
} from '@tangle-network/agent-integrations'

const registry = buildDefaultIntegrationRegistry()
const tools = buildIntegrationToolCatalog(registry.connectors)
const matches = searchIntegrationTools(tools, 'send a slack message', {
  maxRisk: 'write',
})
```

Aliases such as `notion -> notion-database`, `stripe -> stripe-pack`,
`twilio -> twilio-sms`, and `outlook-calendar -> microsoft-calendar` resolve to
one canonical entry while preserving lookup by either name.
