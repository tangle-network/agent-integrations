# TikTok and Amazon Seller Central Workflow

## Goal

Ship a current TikTok provider pack, then build Amazon Seller Central on a separate additive auth change and prove both locally.

## Graph

- Structure: pipeline for TikTok review and merge, followed by an Amazon auth-extension pipeline.
- Parallel work: one reviewer attacks TikTok while one reviewer derives Amazon's current public-app auth contract.
- Barrier: the current agent accepts or rejects both reviews before changing shared auth types.
- Verification: focused provider tests precede the full suite, typecheck, build, execution audit, and credential-redaction checks.
- Synthesis rule: advertise a provider only when its real authorization parameters and request credentials fit the shipped runtime.

## Compiled workflow

1. TikTok pipeline: official-doc review -> security fixes -> focused and full proof -> merge.
2. Amazon research pipeline: official auth contract -> additive shared-auth design -> provider implementation and focused tests.
3. Merge barrier: inspect shared registries and generated audit output once.
4. Platform pipeline: consume the released auth fields in a clean product worktree, then perform a real browser connection when credentials exist.

Expected agents: three active agents for the review barrier, including the current agent.

## Final TikTok security result

- The shared resolver coalesces an expired secret into one refresh and waits for durable persistence.
- Revocation cancels shared refresh and provider-local rotation persistence.
- PKCE is required by default and omitted only for an explicit `unsupported` posture.
- The independent audit reproduced and then cleared five refresh, failure, and revocation races.
- Amazon Seller Central remains catalog-only and non-executable.

## Cal.com public-client result

- The manifest requires PKCE and declares token endpoint authentication as `none`.
- The factory requires `CALCOM_OAUTH_CLIENT_ID` and does not accept a client secret.
- Code exchange and refresh send the client ID without a secret or Basic authorization.
- The connector refreshes expired credentials in both provider execution paths.
- Same-source actions share one refresh request, while different source IDs remain isolated.
- The host must pass the real connection ID as the resolved source ID.
