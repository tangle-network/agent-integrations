# Remaining Provider Rollout Workflow

## Goal

Publish the in-flight provider contract fixes, reconcile the asserted remaining 54 providers, and prove each production connection without creating duplicate provider apps.

## Graph

- Structure: provider pipelines for contract audit, platform wiring, provider configuration, and production connection proof.
- Parallel work: one agent owns package contracts, one owns platform merge work, and one owns the full provider inventory.
- Barrier: the current agent reconciles all three outputs into one provider ledger before any provider dashboard mutation.
- Verification: local package tests precede mergeability checks; production OAuth redirects and connected-state reads prove rollout.
- Termination: repeat only providers still marked contract-only, platform-blocked, provider-blocked, or untested.
- Synthesis rule: count a provider as live only after the production platform records a working connection.

## Compiled workflow

1. Package pipeline: review current contract diff, run the full checks, publish the PR.
2. Parallel pipelines: finish package fixes, finish platform bundle work, and compute the complete provider ledger.
3. Reconciliation barrier: deduplicate providers and existing provider applications by provider-owned application ID and platform secret reference.
4. Browser pipeline: reuse an existing application, complete OAuth, and verify the production connection for each eligible provider.
5. Release pipeline: merge clean PRs, deploy the platform, and repeat production proof on the deployed version.

Expected agents: four active agents, including the current agent.
