# Catalog Registry

`agent-integrations` can ingest several catalog sources:

- first-party adapters
- generated setup specs
- gateway catalogs
- vendored Activepieces metadata
- planning coverage stubs

Those sources intentionally overlap. The public product surface should not.
Use `composeIntegrationRegistry()` or `buildDefaultIntegrationRegistry()` before
building agent tools, connection pickers, setup flows, or planning context.

## Support Tiers

The registry assigns one tier per canonical connector:

| Tier | Meaning |
| --- | --- |
| `catalogOnly` | Known integration metadata. Useful for search/planning, not execution. |
| `setupReady` | Has setup/auth/spec metadata, but still needs an execution provider. |
| `gatewayExecutable` | Executable through a gateway provider. |
| `firstPartyExecutable` | Executable through a first-party adapter. |
| `sandboxExecutable` | Safe to invoke directly from generated sandbox apps. |

Precedence is explicit:

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
