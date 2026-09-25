# Published packages sweep 4

Base audited: `8b3fc7cb51e2b309d668e77c91f4988444ecae1b`.

## Findings

No vendored copy of another Tangle package was found.

The credential resolver, OAuth helpers, connector adapters, webhook/trigger contracts, and managed-messaging provisioning under `src/` are source of the published `@tangle-network/agent-integrations` package itself. They are not consumer-side copies and must not be replaced by importing this package into itself.

`src/managed-messaging/provision.ts` explicitly accepts a host vault port and existing queue rather than owning a credential store or scheduler.

## Boundary

Consumers should import this package. This repository defines the package contract. A sweep must not turn canonical package source into a circular self-dependency.

## Follow-up

Keep package consumers on published releases. Add consumer migrations in those repositories when copied connector, OAuth, trigger, messaging, or credential logic is found.
