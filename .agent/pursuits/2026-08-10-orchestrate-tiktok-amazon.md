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
