# DuckDB Adversarial Surface

| Boundary | Attack | Required invariant | Regression proof |
| --- | --- | --- | --- |
| Table name to SQL identifier | SQL injection or statement stacking | Only a strict identifier is accepted and it is quoted before interpolation | Identifier-injection and case-insensitive duplicate tests |
| User SQL to embedded engine | File/network access, extension loading, persistent writes | External access is disabled and locked; SQL must be a relation-returning subquery | External file-read and write-statement tests |
| JSON tables to schema inference | Malformed or oversized input, deeply nested schema expansion | Input is JSON-serializable and bounded to 10 MiB, 10,000 rows, 16 tables, 256 leaf columns, and 16 nested levels | Real inferred-schema, explicit empty-schema, and nested-column-limit tests |
| Query computation | CPU, memory, thread, or disk exhaustion | Five-second interrupt, 256 MB memory limit, two threads, and no temporary spill | Locked-settings and execution-time tests |
| Query result to caller | Oversized output or integer precision loss | At most 10,000 rows and 10 MiB; 64-bit integers remain decimal strings | Truncation and output-size tests |
| Native package distribution | Missing platform binary or packaging error | A packed consumer can install the dependency and run the native engine | Clean-directory package smoke |
