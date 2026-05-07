# Platform Control Plane Adoption

Use this package when one product owns user connections and many runtimes need
safe access to those connections.

```txt
central platform
  owns OAuth apps, connection storage, grants, approvals, audit, healthchecks

sandbox / generated app / agent runtime
  receives a short-lived capability bundle
  calls /v1/integrations/invoke
  never receives provider refresh tokens or API keys
```

## Required Flow

1. Product code turns app requirements into an `IntegrationManifest`.
2. Platform resolves the manifest against the user's active connections.
3. Missing connections or scopes return a user-facing connect/consent action.
4. Platform creates `IntegrationGrant` records for the approved grantee.
5. Platform issues a short-lived bundle with `buildSandboxBundle()`.
6. Runtime receives only `TANGLE_INTEGRATION_BUNDLE`.
7. Generated app code calls `createTangleIntegrationsClient()`.
8. Platform verifies capability, policy, approval, idempotency, and audit before
   invoking the provider.

## Durable Installs

Preview runs can build bundles by `manifestId` and `grantee`. Installed apps and
published templates often need a narrower path: bind one app instance to known
pre-created grants. Use explicit grant ids:

```ts
const bundle = await runtime.buildSandboxBundle({
  grantIds: ['grant_calendar_read'],
  subject: { type: 'sandbox', id: 'sandbox_123' },
  grantee: { type: 'app', id: 'installed_app_123' },
  ttlMs: 15 * 60_000,
})
```

The runtime fails closed if a grant id is unknown, belongs to another grantee, or
belongs to a different manifest than the requested `manifestId`.

## Production Gates

- Catalog-only connectors are discoverable, not executable.
- Runtime code receives capability tokens only.
- Writes require approval unless product policy explicitly allows them.
- Destructive actions are denied by default.
- Every invoke has an audit event and an idempotency key.
- Revoke deletes credentials and stops future bundles from including the grant.
- Resume/long-running runtimes refresh bundles before expiry.
