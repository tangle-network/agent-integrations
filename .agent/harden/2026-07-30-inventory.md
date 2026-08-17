# Identity Provisioning Security Inventory

## Test infrastructure

- Vitest spans `tests/`, `src/__tests__/`, and connector-local test directories.
- Full run after rebasing onto Recurly, MyCase, Avalara, and TaxJar: 2,186 suites and 4,937 tests.
- New provider tests mock only the provider HTTP boundary; no database or deployed provider account is part of this library repository.

## Evaluation and benchmark infrastructure

- No product evaluation or benchmark runner applies to connector authentication and request rendering.

## Observability

- Provider failures use typed credential/rate-limit errors.
- Connection credentials are passed only at invocation time and redacted from upstream failures.
- No live provider telemetry is available without customer test accounts.
