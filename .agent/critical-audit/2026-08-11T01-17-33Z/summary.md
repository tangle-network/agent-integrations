# Audit: TikTok OAuth and credential lifecycle — 4e07f4d..working-tree — n=23 files, 0 open findings

**Verdict:** APPROVE — four reproduced races are fixed · 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW
**Worst:** No unresolved finding · cost if shipped 0 known incidents
**Next:** run full release proof and publish the exact tarball

## Scope

| Field | Value |
| --- | --- |
| Files | n=23 via working-tree diff |
| Base..head | `4e07f4d..working-tree` |
| Project type | TypeScript package |
| Reviewers | A, B, C · serial |
| Not inspected | Live TikTok account flow; no provider credentials available |

## Findings — 4 of 4, ranked

| # | Sev | file:line | Defect | Failure scenario | Status | Evidence | Fix | Verification | Cost if shipped | Saved if fixed |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: |
| 1 | P1 | `src/credentials.ts:184` | Duplicate refresh redemption | 2 expired actions → 2 uses of one rotating token | measured, fixed | `vitest production-primitives+tiktok` → 53/53 | shared refresh plus durable write | 1 token request, 2 fresh calls | unmeasured | full tested path |
| 2 | P1 | `src/credentials.ts:399` | Shared refresh resurrects revoke | revoke while token call waits → active secret returns | measured, fixed | blocked-refresh regression | cancel refresh before delete | final secret absent and row revoked | unmeasured | full tested path |
| 3 | P1 | `src/credentials.ts:315` | Local rotation resurrects revoke | near-expiry TikTok refresh → callback writes after revoke | measured, fixed | 2 TikTok revoke modes | cancellable persistence lease | both modes reject | unmeasured | full tested path |
| 4 | P1 | `src/credentials.ts:343` | Late active write wins | active write waits → revoke completes → active write finishes | measured, fixed | late-write regression | post-write revocation check | final secret absent and row revoked | unmeasured | full tested path |

0 dropped.

## Assumptions & unverified

| Assumption | Finding it would flip | Check that settles it |
| --- | --- | --- |
| The production host reuses one secret-store object per process | Distributed duplicate refresh risk | Inspect platform store construction |
| Cross-worker exclusion belongs to the durable host store | Distributed revoke race risk | Add a multi-worker storage test |

## Self-gate

9/9 passed — failed: none.
