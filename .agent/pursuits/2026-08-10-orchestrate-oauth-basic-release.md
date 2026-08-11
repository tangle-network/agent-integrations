# OAuth Basic Release Workflow

## Goal

Replace broken package version `0.53.49` with a correctly encoded and credential-safe release, then adopt it without replacing existing provider configuration.

## Graph

- Structure: a package release pipeline followed by a platform adoption pipeline.
- Parallel work: one reviewer attacks credential redaction while provider setup continues in a separate browser track.
- Barrier: package merge and trusted registry publication must complete before the platform can pin the corrected version.
- Verification: focused OAuth tests, full tests, typecheck, build, execution audit, packed-package smoke, platform contracts, and production click-through.
- Synthesis rule: release only when installed-package encoding and every tested provider-reflection form redact correctly.

## Compiled Workflow

1. Package pipeline: fix encoding and redaction, run focused and full proof, merge pull request 285.
2. Release pipeline: prepare `0.53.50`, merge through the trusted publish path, and verify registry contents.
3. Platform pipeline: replace all `0.53.49` pins, preserve credential tombstones, run product checks, and merge to `develop`.
4. Production pipeline: cut a fresh frozen release, deploy, and prove the integrations page and OAuth callback through the public app.

Expected agents: three active agents, including the current implementation worker, one independent security reviewer, and one provider setup worker.
