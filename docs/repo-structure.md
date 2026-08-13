# Repository Structure

This repo intentionally separates catalog breadth from executable runtime code.

## Source

- `src/index.ts` exports the public package surface.
- `src/actions.ts` defines canonical launch action ids and schemas for the
  first product-ready connectors.
- `src/client.ts` is the tiny generated-app/sandbox client over platform
  `/v1/integrations/invoke`.
- `src/manifest.ts` validates and infers `IntegrationManifest` values.
- `src/consent.ts` renders user-facing consent/approval copy from manifests.
- `src/runtime.ts` resolves manifests, creates grants, and builds sandbox
  bundles.
- `src/bridge.ts` encodes scoped sandbox/CLI bridge payloads.
- `src/sandbox.ts` validates sandbox invocation envelopes and normalizes
  invocation results.
- `src/policy.ts`, `src/presets.ts`, `src/approval.ts`, `src/guard.ts`,
  `src/audit.ts`, `src/healthcheck.ts`, `src/credentials.ts`, and
  `src/events.ts` are production control-plane primitives.
- `src/connectors/` contains first-party adapter contracts and implementations.
- `src/connectors/bundled-manifest-data.ts` contains the static manifest snapshot;
  `src/connectors/bundled-manifests.ts` keeps runtime adapter discovery separate.
- `src/specs/` is the structured OAuth/setup/runbook source of truth.
- `src/registry-core.ts`, `src/registry.ts`, `src/gateway-catalog.ts`,
  `src/coverage-catalog.ts`, and `src/tangle-catalog.ts` compose broad connector
  catalogs while keeping execution behind configured native, gateway, or
  sandbox runtimes.
- `src/worker.ts` is the Worker-safe entry point for guard, audit, policy, and
  core contracts.

## Data

- Imported catalog JSON is large by design. Data-only runtime modules keep
  long-tail discovery out of TypeScript source so `tsc --watch` does not
  re-check a generated 40k-line module. Bundled `/specs` and `/catalog` data
  does not import executable adapters or their Node-only clients.

## Build Artifacts

- `dist/` is published because the package ships compiled ESM and `.d.ts`
  files to npm.
- `node_modules/` is local development state and is not published.

## Docs

- `docs/production-completion-checklist.md` defines what this package owns and
  what product repos must still implement.
- `docs/catalog-registry.md` explains support tiers.
- `docs/provider-decision-matrix.md` explains when to use first-party adapters,
  gateway providers, or catalog-only metadata.
