# Harden Report — OAuth Refresh and Public Clients

## Proven invariants

| Invariant | Inputs tested | Result |
| --- | ---: | --- |
| Two expired-token actions redeem one refresh token | 2 simultaneous actions in 2 test paths | Holds |
| Both actions wait for durable secret persistence | 2 waiters with 1 blocked asynchronous write | Holds |
| A failed shared refresh clears for retry | 2 failed waiters and 1 retry | Holds |
| Failure creates no transient unhandled rejection | 1 shared rejection with 2 waiters | Holds |
| Revocation remains final across controlled race windows | 5 independent race probes | Holds |
| Unsupported TikTok PKCE omits challenge and verifier | 2 OAuth paths | Holds |
| Required or unknown PKCE rejects omission | 3 posture cases | Holds |
| Public-client exchange and refresh omit every client secret | 2 token operations | Holds |
| Confidential methods reject a missing secret before network access | 4 method and operation combinations | Holds |
| Concurrent Cal.com actions share refresh only within one source ID | 2 same-source and 2 cross-source actions | Holds |
| Cal.com rotation persistence completes before the action returns | 2 provider paths | Holds |

## Findings fixed

| Severity | Boundary | Failure before fix | Verification after fix |
| --- | --- | --- | --- |
| High | Rotating refresh token | Two actions redeemed `old-refresh-token` twice | 1 token request and 2 fresh bearer calls |
| High | Shared refresh revocation | Refresh restored a deleted secret and active row | Invocation rejects; secret absent; row revoked |
| High | Provider-local rotation revocation | Near-expiry refresh restored credentials after revoke | Full-store and secret-only cases reject |
| High | Late persistence revocation | A delayed active-row write overwrote revocation | Post-write check restores the revoked row |

## Dependency and credential findings

- `pnpm audit --audit-level high` reports zero known vulnerabilities after the Nano ID override.
- Token, client secret, authorization code, and PKCE verifier errors have redaction tests.
- No provider credential was written to source or an audit artifact.
- Cal.com factory metadata requires only `CALCOM_OAUTH_CLIENT_ID`.
- The public-client token body contains `client_id` and omits `client_secret` and Basic authorization.

## Residual risk

- Refresh coalescing uses one secret-store object in one process.
- A distributed host must add storage-level locking or compare-and-swap across workers.
- No live TikTok account authorization was available for this package-only repair.
- Cal.com refresh isolation depends on the host using the real connection ID as `ResolvedDataSource.id`.

## Verdict

No critical or high finding remains in the tested package boundary.
The focused OAuth and Cal.com run passed 54 of 54 tests.
The full suite passed 5,249 of 5,249 tests across 692 files.
