# Integration Execution Audit

Generated from the current checkout by `node scripts/audit-integration-execution.mjs`.

This audit separates four very different states that were getting conflated:

- **Cataloged**: we know the connector exists and have normalized metadata.
- **Setup-ready**: we have setup/auth/runbook metadata for product UI and admin configuration.
- **First-party executable**: this repo ships a reviewed adapter implementation.
- **Package-runtime executable**: a Tangle runtime service has the connector package installed, credentials resolvable, and action-name mapping verified.

## Summary

| Item | Count |
| --- | ---: |
| Catalog connectors | 669 |
| Catalog connectors with runtime package names | 669 |
| Catalog actions | 3790 |
| Catalog triggers | 998 |
| Catalog triggers with verified upstream names in this repo | 998 |
| Catalog actions with verified upstream action names in this repo | 3790 |
| Catalog connectors with auth field metadata | 648 |
| Custom-auth connectors with auth field metadata | 11 |
| Runtime package dependencies declared by this package | 0 |
| Setup specs | 142 |
| Executable setup specs | 14 |
| Catalog/setup-only specs | 128 |
| First-party adapter surfaces | 16 |
| Tangle catalog connectors exposable behind runtime | 669 |
| Tangle catalog actions exposable behind runtime | 3970 |

Full machine-readable matrix: [integration-execution-matrix.json](./integration-execution-matrix.json).

## Auth Breakdown

| Auth | Connectors |
| --- | --- |
| api_key | 519 |
| oauth2 | 118 |
| none | 21 |
| custom | 11 |

## Category Breakdown

| Category | Connectors |
| --- | --- |
| workflow | 271 |
| crm | 178 |
| docs | 76 |
| chat | 58 |
| storage | 29 |
| database | 28 |
| webhook | 18 |
| email | 5 |
| calendar | 3 |
| internal | 3 |

## First-Party Executable Surfaces

These are implemented in `src/connectors/adapters` or represented as executable setup specs:

- `google-calendar`
- `google-sheets`
- `microsoft-calendar`
- `hubspot`
- `slack`
- `notion-database`
- `twilio-sms`
- `stripe-pack`
- `webhook`
- `stripe`
- `slack-inbound`
- `github`
- `gitlab`
- `airtable`
- `asana`
- `salesforce`

Executable setup specs:

- `airtable`
- `asana`
- `github`
- `gitlab`
- `google-calendar`
- `google-sheets`
- `hubspot`
- `microsoft-calendar`
- `notion-database`
- `salesforce`
- `slack`
- `stripe-pack`
- `twilio-sms`
- `webhook`

## Flow Readiness

| Flow | Status | Concrete state |
| --- | --- | --- |
| Connector discovery/catalog search | Done | 669 catalog connectors, 3790 actions, 998 triggers normalized into Tangle catalog shapes. |
| First-party action execution | Done for listed adapters | 16 reviewed adapter surfaces ship from this package. |
| OAuth/API-key setup metadata | Partial | 142 setup specs exist; 14 are executable setup specs and 128 are catalog/setup-only. |
| Long-tail package action execution | Wiring done; package install/smoke pending | 669 entries have package names and 3790 actions have upstream names. Runtime packages are not bundled into this npm package. |
| Long-tail credential mapping | Mostly mapped | 648 connectors have auth field metadata. 0 custom-auth connectors still need exact manual auth fields. |
| Trigger provider flow | Done structurally | 998 triggers are cataloged, 998 have upstream names, and catalog providers can route subscribe/unsubscribe/normalize hooks. Runtime services still need package-specific trigger hosting. |
| Sandbox/app invocation envelope | Done | The library has capability bundles, invocation envelopes, policy checks, guard hooks, signed catalog runtime HTTP calls, and generated-app client helpers. |
| Live provider smoke tests | Not globally done | First-party adapters can be tested by consumers with credentials; long-tail smoke matrix is not generated yet. |

## Concrete Not-Done Buckets

| Bucket | Count | What it means |
| --- | ---: | --- |
| Catalog connectors needing package-runtime verification | 659 | Connector has a known runtime package but is not a first-party adapter here. |
| Catalog connectors with zero verified action mappings | 0 | We normalized action labels, but have not checked the exact runtime action export names into the catalog. |
| Custom-auth catalog connectors needing manual credential-field mapping | 0 | These are still custom auth and no field names were extracted from source. |
| Catalog connectors with triggers needing runtime-service hosting | 288 | Trigger metadata and provider hooks exist; runtime services still need package-specific webhook/polling hosting. |

Examples needing package-runtime verification:

- `activecampaign` -> `@activepieces/piece-activecampaign`
- `activepieces` -> `@activepieces/piece-activepieces`
- `actualbudget` -> `@activepieces/piece-actualbudget`
- `acuity-scheduling` -> `@activepieces/piece-acuity-scheduling`
- `acumbamail` -> `@activepieces/piece-acumbamail`
- `afforai` -> `@activepieces/piece-afforai`
- `agentx` -> `@activepieces/piece-agentx`
- `ai` -> `@activepieces/piece-ai`
- `aianswer` -> `@activepieces/piece-aianswer`
- `aidbase` -> `@activepieces/piece-aidbase`
- `aiprise` -> `@activepieces/piece-aiprise`
- `air-ops` -> `@activepieces/piece-air-ops`
- `aircall` -> `@activepieces/piece-aircall`
- `airparser` -> `@activepieces/piece-airparser`
- `airtop` -> `@activepieces/piece-airtop`
- `alai` -> `@activepieces/piece-alai`
- `algolia` -> `@activepieces/piece-algolia`
- `alt-text-ai` -> `@activepieces/piece-alt-text-ai`
- `alttextify` -> `@activepieces/piece-alttextify`
- `amazon-bedrock` -> `@activepieces/piece-amazon-bedrock`
- `amazon-s3` -> `@activepieces/piece-amazon-s3`
- `amazon-secrets-manager` -> `@activepieces/piece-amazon-secrets-manager`
- `amazon-ses` -> `@activepieces/piece-amazon-ses`
- `amazon-sns` -> `@activepieces/piece-amazon-sns`
- `amazon-sqs` -> `@activepieces/piece-amazon-sqs`
- `amazon-textract` -> `@activepieces/piece-amazon-textract`
- `aminos` -> `@activepieces/piece-aminos`
- `ampeco` -> `@activepieces/piece-ampeco`
- `anyhook-graphql` -> `@activepieces/piece-anyhook-graphql`
- `anyhook-websocket` -> `@activepieces/piece-anyhook-websocket`
- `apify` -> `@activepieces/piece-apify`
- `apitable` -> `@activepieces/piece-apitable`
- `apitemplate-io` -> `@activepieces/piece-apitemplate-io`
- `apollo` -> `@activepieces/piece-apollo`
- `appfollow` -> `@activepieces/piece-appfollow`
- `ashby` -> `@activepieces/piece-ashby`
- `ask-handle` -> `@activepieces/piece-ask-handle`
- `asknews` -> `@activepieces/piece-asknews`
- `assembled` -> `@activepieces/piece-assembled`
- `assemblyai` -> `@activepieces/piece-assemblyai`

Examples needing manual custom auth mapping:



## What Is Not Done

1. **Package runtime installation is not bundled into this npm package.**
   All 669 catalog entries have runtime package names, but `package.json` intentionally declares 0 long-tail runtime packages. The runtime service must install the packages it wants to execute.

2. **Action-name mapping is complete for cataloged actions.**
   Done for cataloged actions: the catalog currently has 3790 actions and 3790 verified upstream action-name mappings in the checked-in catalog. The runtime executor uses those names automatically and still accepts explicit `actionAliases` for overrides.

3. **Credential field mapping is complete for catalog auth setup.**
   Auth shapes are api_key: 519, oauth2: 118, none: 21, custom: 11. The catalog now includes auth field metadata for all 648 connectors that require credentials. 0 custom-auth connectors need manual auth-field mapping.

4. **Triggers are cataloged, not universally hosted.**
   There are 998 catalog triggers and 998 upstream trigger names. The provider flow now supports trigger subscribe/unsubscribe/normalize hooks. Runtime services still need package-specific webhook/polling hosting.

5. **First-party coverage is intentionally smaller than catalog breadth.**
   This repo ships 16 first-party surfaces. The other catalog connectors depend on the package-runtime path.

## Concrete Launch Interpretation

- It is accurate to say: **we have a 669-connector Tangle catalog and a generic runtime execution path.**
- It is accurate to say: **a connector can work with minimal app code when its runtime package is installed, auth is resolvable, and action aliases are configured.**
- It is not accurate to say: **all 669 connectors are guaranteed to work out of the box today with zero runtime package/action/auth work.**

## Next Gap To Close

Build a runtime coverage generator that installs/imports each package in isolation, extracts real action names, writes `actionAliases`, and emits a pass/fail matrix per connector:

- package loads
- package installed in the runtime service
- package load verified
- normalized action maps to real action
- auth shape identified or marked as manual
- dry-run invocation possible
- live smoke credential available
