# Test Infrastructure Inventory — OAuth Refresh and Public Clients

## Test infrastructure

- Vitest runs 692 files and 5,249 tests.
- Credential lifecycle tests use the real provider wrapper and real in-memory store contracts.
- Provider HTTP is mocked only at the external network boundary.
- Cal.com tests cover both the credential-backed provider and the executor-style provider.

## Evaluation infrastructure

- The repository uses `.agent/` run artifacts.
- This security change has deterministic race regressions in the existing Vitest suite.
- Public-client token requests have request-body assertions in the existing OAuth and Cal.com suites.

## Benchmark infrastructure

- No concurrency benchmark runner exists.
- Deterministic blocked-promise tests control each refresh and persistence window.
- Cal.com tests run same-source and cross-source refresh calls concurrently.

## Observability

- The package exposes host callbacks for credential rotation and connection errors.
- The tests attach an `unhandledRejection` observer for ignored rotation callbacks.
