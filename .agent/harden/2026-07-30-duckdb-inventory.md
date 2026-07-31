# DuckDB Security Inventory

## Test infrastructure

- Vitest runs the repository suite from `tests/`, `src/__tests__/`, `src/connectors/adapters/__tests__/`, and `src/delegated-tools/__tests__/`.
- The DuckDB tests execute the real `@duckdb/node-api` engine in memory; they do not mock the database boundary.
- The final merged-tree run passed 680/680 files and 5,072/5,072 tests.

## Evaluation and benchmark infrastructure

- `.agent/` exists for resumable skill state.
- No DuckDB-specific evaluation or benchmark runner exists; resource limits are asserted through the existing Vitest suite.

## Observability

- Adapter invocations return bounded rows, row count, truncation state, column types, and fetch time through the standard connector result contract.
- The adapter does not log SQL, input rows, query arguments, or results.
