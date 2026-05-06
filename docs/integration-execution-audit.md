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
| Catalog actions | 3783 |
| Catalog triggers | 999 |
| Catalog actions with verified upstream action names in this repo | 0 |
| Runtime package dependencies declared by this package | 0 |
| Setup specs | 142 |
| Executable setup specs | 14 |
| Catalog/setup-only specs | 128 |
| First-party adapter surfaces | 16 |
| Tangle catalog connectors exposable behind runtime | 669 |
| Tangle catalog actions exposable behind runtime | 3963 |

Full machine-readable matrix: [integration-execution-matrix.json](./integration-execution-matrix.json).

## Auth Breakdown

| Auth | Connectors |
| --- | --- |
| api_key | 334 |
| custom | 248 |
| oauth2 | 69 |
| none | 18 |

## Category Breakdown

| Category | Connectors |
| --- | --- |
| workflow | 296 |
| webhook | 91 |
| crm | 63 |
| storage | 50 |
| email | 49 |
| chat | 48 |
| docs | 23 |
| calendar | 22 |
| database | 16 |
| internal | 11 |

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
| Connector discovery/catalog search | Done | 669 catalog connectors, 3783 actions, 999 triggers normalized into Tangle catalog shapes. |
| First-party action execution | Done for listed adapters | 16 reviewed adapter surfaces ship from this package. |
| OAuth/API-key setup metadata | Partial | 142 setup specs exist; 14 are executable setup specs and 128 are catalog/setup-only. |
| Long-tail package action execution | Runtime path exists; coverage unverified | 669 entries have package names, but runtime packages are not bundled and 0 catalog actions have verified upstream action mappings. |
| Long-tail credential mapping | Partial | api_key: 334, oauth2: 69, custom: 248, none: 18. Custom connectors need per-package credential shaping before execution can be claimed. |
| Trigger hosting/subscription | Partial | 999 triggers are cataloged. Runtime action invocation exists; universal trigger install/hosting is not done. |
| Sandbox/app invocation envelope | Done | The library has capability bundles, invocation envelopes, policy checks, guard hooks, signed catalog runtime HTTP calls, and generated-app client helpers. |
| Live provider smoke tests | Not globally done | First-party adapters can be tested by consumers with credentials; long-tail smoke matrix is not generated yet. |

## Concrete Not-Done Buckets

| Bucket | Count | What it means |
| --- | ---: | --- |
| Catalog connectors needing package-runtime verification | 659 | Connector has a known runtime package but is not a first-party adapter here. |
| Catalog connectors with zero verified action mappings | 570 | We normalized action labels, but have not checked the exact runtime action export names into the catalog. |
| Custom-auth catalog connectors needing credential shape mapping | 248 | A generic OAuth/API-key form is not enough; the runtime must shape auth exactly as the package expects. |
| Catalog connectors with triggers needing hosted trigger support | 288 | Trigger metadata exists, but trigger subscription/webhook execution is not universally implemented. |

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

Examples needing custom auth mapping:

- `activecampaign` -> `@activepieces/piece-activecampaign`
- `acumbamail` -> `@activepieces/piece-acumbamail`
- `afforai` -> `@activepieces/piece-afforai`
- `agentx` -> `@activepieces/piece-agentx`
- `aiprise` -> `@activepieces/piece-aiprise`
- `aircall` -> `@activepieces/piece-aircall`
- `airparser` -> `@activepieces/piece-airparser`
- `alt-text-ai` -> `@activepieces/piece-alt-text-ai`
- `alttextify` -> `@activepieces/piece-alttextify`
- `amazon-bedrock` -> `@activepieces/piece-amazon-bedrock`
- `amazon-s3` -> `@activepieces/piece-amazon-s3`
- `amazon-secrets-manager` -> `@activepieces/piece-amazon-secrets-manager`
- `amazon-ses` -> `@activepieces/piece-amazon-ses`
- `amazon-textract` -> `@activepieces/piece-amazon-textract`
- `anyhook-graphql` -> `@activepieces/piece-anyhook-graphql`
- `anyhook-websocket` -> `@activepieces/piece-anyhook-websocket`
- `apollo` -> `@activepieces/piece-apollo`
- `ask-handle` -> `@activepieces/piece-ask-handle`
- `assembled` -> `@activepieces/piece-assembled`
- `assemblyai` -> `@activepieces/piece-assemblyai`
- `avian` -> `@activepieces/piece-avian`
- `avoma` -> `@activepieces/piece-avoma`
- `azure-blob-storage` -> `@activepieces/piece-azure-blob-storage`
- `azure-openai` -> `@activepieces/piece-azure-openai`
- `barcode-lookup` -> `@activepieces/piece-barcode-lookup`
- `baremetrics` -> `@activepieces/piece-baremetrics`
- `beamer` -> `@activepieces/piece-beamer`
- `bigin-by-zoho` -> `@activepieces/piece-bigin-by-zoho`
- `billplz` -> `@activepieces/piece-billplz`
- `bland-ai` -> `@activepieces/piece-bland-ai`
- `bluesky` -> `@activepieces/piece-bluesky`
- `browserless` -> `@activepieces/piece-browserless`
- `bumpups` -> `@activepieces/piece-bumpups`
- `bursty-ai` -> `@activepieces/piece-bursty-ai`
- `buttondown` -> `@activepieces/piece-buttondown`
- `camb-ai` -> `@activepieces/piece-camb-ai`
- `campaign-monitor` -> `@activepieces/piece-campaign-monitor`
- `canny` -> `@activepieces/piece-canny`
- `capsule-crm` -> `@activepieces/piece-capsule-crm`
- `cashfree-payments` -> `@activepieces/piece-cashfree-payments`

## What Is Not Done

1. **Package runtime installation is not bundled into this npm package.**
   All 669 catalog entries have runtime package names, but `package.json` intentionally declares 0 long-tail runtime packages. The runtime service must install the packages it wants to execute.

2. **Action-name mapping is not complete.**
   The catalog currently has 3783 actions and 0 verified upstream action-name mappings in the checked-in catalog. The runtime executor supports `actionAliases`, but production aliases must be generated/verified before claiming every action works.

3. **Credential shape mapping is not complete for every connector.**
   Auth shapes are custom: 248, api_key: 334, oauth2: 69, none: 18. The runtime must map each user connection/secret into the shape expected by that package.

4. **Triggers are cataloged, not universally hosted.**
   There are 999 catalog triggers. The current Tangle catalog runtime executes actions. Trigger subscription/webhook hosting still needs per-provider runtime support.

5. **First-party coverage is intentionally smaller than catalog breadth.**
   This repo ships 16 first-party surfaces. The other catalog connectors depend on the package-runtime path.

## Concrete Launch Interpretation

- It is accurate to say: **we have a 669-connector Tangle catalog and a generic runtime execution path.**
- It is accurate to say: **a connector can work with minimal app code when its runtime package is installed, auth is resolvable, and action aliases are configured.**
- It is not accurate to say: **all 669 connectors are guaranteed to work out of the box today with zero runtime package/action/auth work.**

## Next Gap To Close

Build a runtime coverage generator that installs/imports each package in isolation, extracts real action names, writes `actionAliases`, and emits a pass/fail matrix per connector:

- package loads
- action list extracted
- normalized action maps to real action
- auth shape identified
- dry-run invocation possible
- live smoke credential available
