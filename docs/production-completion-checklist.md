# Production Completion Checklist

This is the library-owned done bar for `agent-integrations`. Product repos still
own UI, DB adapters, vault deployment, enabled-connector policy, and live
provider credentials.

## Complete In This Package

- [x] Normalized connector, action, trigger, connection, and capability types.
- [x] Vendor-neutral `IntegrationHub` facade for provider catalogs, auth,
      connections, scoped capability issue/verify, and action invocation.
- [x] First-party connector adapter boundary and declarative REST adapter path.
- [x] Generated setup specs and runbook/admin-UI renderers.
- [x] Canonical registry that dedupes setup specs, first-party adapters,
      gateway catalogs, and long-tail catalog metadata.
- [x] Catalog runtime safety: long-tail contracts are discoverable, but only
      registries configured with a native, gateway, or sandbox runtime expose
      them as callable tools.
- [x] App/agent `IntegrationManifest` resolution against user connections.
- [x] Persistent grants from user-owned connections to apps, agents, sandboxes,
      and generated software.
- [x] Sandbox bundles with short-lived capability tokens and tool definitions.
- [x] Explicit grant-id bundle issuance for installed apps, published templates,
      and durable app instances.
- [x] Bridge payload/env helpers for sandbox processes and executor-style CLIs.
- [x] Sandbox invocation host that validates envelopes before hub invocation and
      normalizes success, failure, and approval-required results.
- [x] Policy engine for allow/deny/approval decisions.
- [x] Approval store and approval-backed policy resume path.
- [x] Idempotency guard with replay, same-key drift detection, dry-run mutation
      handling, optional rate-limit hook, and audit records.
- [x] Audit event store/sink and redaction helpers.
- [x] Healthcheck primitives for connection status, executable tier, scope
      shape, and optional live provider tests.
- [x] Credential resolver and secret-store interface for resolving secret refs,
      refreshing expired OAuth credentials, and revoking connections.
- [x] Workflow runtime for trigger subscription install and normalized event
      dispatch.
- [x] Webhook ingestion runtime for signature checks, provider-event dedupe, and
      workflow dispatch.
- [x] Focused tests for hub, registry, runtime grants, workflow triggers,
      sandbox invocation, approval resume, idempotency, credentials,
      healthchecks, bridge payloads, and webhook dedupe.

## Product Integration Checklist

- [ ] Persist `IntegrationConnection`, `IntegrationGrant`, approval, audit,
      healthcheck, workflow, and event stores in the product database.
- [ ] Back `IntegrationSecretStore` with the production vault/KMS.
- [ ] Add OAuth/API-key setup UI from `IntegrationSpec` renderers.
- [ ] Add connect, approve, revoke, rotate, healthcheck, and audit-log screens.
- [ ] Feed generated app requirements into `IntegrationManifest`.
- [ ] Inject `buildIntegrationBridgeEnvironment()` into sandbox launches.
- [ ] Route sandbox tool calls through `dispatchIntegrationInvocation()`.
- [ ] Run live OAuth and browser E2E tests for each shipped product.

## Executor.sh And Sandbox CLIs

Executor-style CLIs are an execution layer, not the integration source of truth.
They can consume this package cleanly by receiving the bridge env payload inside
the sandbox and calling back to the product integration hub with capability
tokens. The CLI never needs OAuth refresh tokens or provider API keys.

Use executor-style tooling when it improves sandbox process orchestration,
command execution, or workflow hosting. Do not make it the credential broker or
canonical connector registry unless a product explicitly chooses that provider.
