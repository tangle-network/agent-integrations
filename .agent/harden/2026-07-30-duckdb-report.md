# Harden Report — DuckDB Provider Pack

## Proven invariants

| Invariant | Proof | Result |
| --- | --- | --- |
| Dynamic values use native parameters | Two-table aggregation with `$1` and `args` | Holds |
| Table names cannot inject SQL | Malicious identifier is rejected before an instance opens | Holds |
| User SQL cannot read host files | `read_csv_auto('/etc/passwd')` fails with external access disabled | Holds |
| User SQL cannot execute a write statement | `DELETE FROM items` cannot parse inside the enforced result subquery | Holds |
| Security settings cannot be relaxed by user SQL | Runtime query returns `external_access=false`, `lock_configuration=true`, `threads=2`, and a 244.1 MiB memory ceiling | Holds |
| Result volume is bounded | Three rows truncate to two; a result larger than 10 MiB is rejected | Holds |
| Long-running computation is bounded | A trillion-row trigonometric aggregation is interrupted after five seconds | Holds |
| The published shape contains a working native runtime | Tarball installed in a clean directory and returned `SUM(value)=5` | Holds on the development machine |

## Findings fixed

- Explicit input schemas initially omitted the surrounding array required by DuckDB's JSON structure format. The loader now binds `[schema]`, and an empty-table regression proves it.
- Per-row column limits initially allowed disjoint rows to create more than 256 total columns. The loader now bounds the distinct column union for each table.
- Top-level schema limits initially allowed nested structures to expand past 256 leaf columns. Explicit and inferred schemas now have bounded leaf count and nesting depth.
- A connection failure after instance creation could bypass instance cleanup. Connection creation now runs inside the protected lifecycle, with nested cleanup preserving instance closure.
- Package setup copy initially implied an endpoint existed. DuckDB now states that no account, endpoint, or credential is required and explains parameter binding and ephemeral state.

## Dependency and credential findings

- `pnpm audit --prod --audit-level moderate` reports zero known vulnerabilities.
- This connector has no provider credential, endpoint, or persisted database file.
- No SQL, table data, arguments, or results are logged.

## Residual risk

- The clean-package native smoke ran on the development machine. The Linux x64 binary still needs the production rollout's install and query smoke before the provider can be called live there.
- DuckDB is a native dependency and must remain pinned and included in routine dependency scanning.

## Verdict

No critical or high security findings remain. The provider is ready for merge after the final full suite and clean merge check.
