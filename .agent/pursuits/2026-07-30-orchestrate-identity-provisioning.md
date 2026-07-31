# Identity Provisioning Pack Workflow

## Goal

Add executable PingOne, OneLogin, and generic SCIM provider packs, then release them with the already-merged Recurly pack.

## Graph

- Structure: pipeline for each provider implementation, followed by one merge barrier for shared exports, coverage, and release metadata.
- Parallel work: PingOne, OneLogin, and SCIM provider surfaces are independent.
- Verification policy: focused provider tests run per implementation; the combined branch then runs the full suite, typecheck, build, execution audit, security review, and GitHub review checks.
- Synthesis rule: accept only provider implementations that fail closed on tenant routing, redact credential failures, expose read and approved-write actions, and register direct execution coverage.

## Compiled workflow

1. Three independent provider pipelines: inspect current patterns -> implement adapter -> add focused regression tests.
2. Merge barrier: update shared exports, registry, coverage, and specifications once.
3. Combined verification: focused tests -> full tests/typecheck/build/audits -> secret/debug scan.
4. Release: merge feature PR, bump version, merge release PR, annotated tag, verify npm version and integrity.

Expected agents: three total implementation workers, including the current agent. Existing session-wide workers already occupy the remaining concurrency slots, so this worker executes all three provider pipelines locally while those independent release/platform tracks continue in parallel.
