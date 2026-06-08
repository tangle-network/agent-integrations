# Integration Execution Audit

Generated from the current checkout by `node scripts/audit-integration-execution.mjs`.

This audit separates product contracts from implementation backends:

- **Tangle contract**: the connector has a Tangle-owned action/trigger/auth contract.
- **Setup-ready**: we have setup/auth/runbook metadata for product UI and admin configuration.
- **Native adapter backend**: this repo ships a reviewed direct adapter implementation.
- **Package runtime backend**: a Tangle runtime service executes the connector package behind the same Tangle contract.

## Summary

| Item | Count |
| --- | ---: |
| Catalog connectors | 669 |
| Catalog connectors with runtime package names | 669 |
| Catalog actions | 3790 |
| Catalog triggers | 998 |
| Catalog triggers with upstream names | 998 |
| Catalog actions with upstream action names | 3790 |
| Catalog connectors with auth field metadata | 648 |
| Custom-auth connectors with auth field metadata | 11 |
| Runtime package dependencies declared by this package | 0 |
| Setup specs | 143 |
| Executable setup specs | 15 |
| Catalog/setup-only specs | 128 |
| Tangle first-class contracts | 669 |
| Contracts with runtime packages | 669 |
| Contracts with mapped actions | 669 |
| Contracts with mapped triggers | 669 |
| Contracts with mapped auth | 669 |
| Native adapter backends | 432 |
| Native adapter surfaces shipped | 466 |
| Package-runtime backends | 237 |
| Runtime manifest dependencies for catalog-only connectors | 238 |
| Catalog-only connectors exposable behind runtime | 237 |
| Catalog-only actions exposable behind runtime | 1081 |

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

## Native Adapter Backends

These are direct in-repo implementations. They are not the only first-class contracts.
The full set is in the machine-readable matrix; representative native adapters:

- `activecampaign`
- `acumbamail`
- `adobe-creative-cloud`
- `afforai`
- `agentx`
- `aidbase`
- `aiprise`
- `air-ops`
- `aircall`
- `airtable`
- `airtop`
- `alai`
- `alt-text-ai`
- `alttextify`
- `amazon-bedrock`
- `amazon-secrets-manager`
- `amazon-ses`
- `amazon-sns`
- `amazon-sqs`
- `amazon-textract`
- `aminos`
- `ampeco`
- `anthropic`
- `apitable`
- `apitemplate-io`
- `apollo`
- `appfollow`
- `asana`
- `ashby`
- `asknews`
- `assemblyai`
- `attio`
- `auth0`
- `autocalls`
- `avian`
- `avoma`
- `azure-ad`
- `azure-communication-services`
- `azure-openai`
- `backblaze`
- `bamboohr`
- `barcode-lookup`
- `baremetrics`
- `basecamp`
- `beamer`
- `bettermode`
- `bexio`
- `bigcommerce`
- `bigin-by-zoho`
- `billplz`
- `bitly`
- `bland-ai`
- `bluesky`
- `bolna`
- `bonjoro`
- `bookedin`
- `box`
- `brave-search`
- `braze`
- `brilliant-directories`
- `browse-ai`
- `cal-com`
- `calendly`
- `campaign-monitor`
- `canny`
- `canva`
- `capsule-crm`
- `captain-data`
- `cashfree-payments`
- `certopus`
- `chainalysis-api`
- `chargebee`
- `chargekeep`
- `chartly`
- `chat-data`
- `chatbase`
- `chatling`
- `chatnode`
- `chatwoot`
- `checkout`

...and 386 more native adapter surfaces.

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
- `phony`
- `salesforce`
- `slack`
- `stripe-pack`
- `twilio-sms`
- `webhook`

## Flow Readiness

| Flow | Status | Concrete state |
| --- | --- | --- |
| Tangle first-class contracts | Done | 669 connectors have Tangle-owned action/trigger/auth/runtime contracts. |
| Connector discovery/catalog search | Done | 669 catalog connectors, 3790 actions, 998 triggers normalized into Tangle catalog shapes. |
| Native adapter execution | Done for listed native backends | 466 reviewed native adapter surfaces ship from this package; 432 overlap the 669 catalog contracts. |
| OAuth/API-key setup metadata | Partial | 142 setup specs exist; 14 are executable setup specs and 128 are catalog/setup-only. |
| Package-runtime action execution | Wiring done; runtime deployment/smoke pending | 237 contracts use package-runtime backends with package names and 3790 catalog upstream action names. |
| Runtime dependency manifest | Done | `buildTangleCatalogRuntimePackageManifest()` emits 238 dependencies for the remaining package-runtime worker install. |
| Runtime package coverage audit | Done | `auditTangleCatalogRuntimePackages()` and `tangle-catalog-runtime --audit-packages` verify installed packages, piece exports, exact action mappings, and trigger surfaces in a deployed worker. |
| Long-tail credential mapping | Mostly mapped | 648 connectors have auth field metadata. 0 custom-auth connectors still need exact manual auth fields. |
| Trigger provider flow | Done structurally | 998 triggers are cataloged, 998 have upstream names, and catalog providers can route subscribe/unsubscribe/normalize hooks. Runtime services still need package-specific trigger hosting. |
| Sandbox/app invocation envelope | Done | The library has capability bundles, invocation envelopes, policy checks, guard hooks, signed catalog runtime HTTP calls, and generated-app client helpers. |
| Live provider smoke tests | Not globally done | First-party adapters can be tested by consumers with credentials; long-tail smoke matrix is not generated yet. |

## Concrete Not-Done Buckets

| Bucket | Count | What it means |
| --- | ---: | --- |
| Package-runtime contracts needing deployed runtime smoke verification | 237 | Connector has a Tangle contract and package backend; deployed runtime still needs package-load/live-smoke proof. |
| Catalog connectors with zero upstream action names | 0 | These entries need catalog action-name mapping before exact package-runtime invocation can work. |
| Custom-auth catalog connectors needing manual credential-field mapping | 0 | These are still custom auth and no field names were extracted from source. |
| Catalog connectors with triggers needing runtime-service hosting | 288 | Trigger metadata and provider hooks exist; runtime services still need package-specific webhook/polling hosting. |

Examples needing deployed runtime smoke verification:

- `activepieces` -> `@activepieces/piece-activepieces`
- `actualbudget` -> `@activepieces/piece-actualbudget`
- `acuity-scheduling` -> `@activepieces/piece-acuity-scheduling`
- `ai` -> `@activepieces/piece-ai`
- `aianswer` -> `@activepieces/piece-aianswer`
- `airparser` -> `@activepieces/piece-airparser`
- `algolia` -> `@activepieces/piece-algolia`
- `amazon-s3` -> `@activepieces/piece-amazon-s3`
- `anyhook-graphql` -> `@activepieces/piece-anyhook-graphql`
- `anyhook-websocket` -> `@activepieces/piece-anyhook-websocket`
- `apify` -> `@activepieces/piece-apify`
- `ask-handle` -> `@activepieces/piece-ask-handle`
- `assembled` -> `@activepieces/piece-assembled`
- `azure-blob-storage` -> `@activepieces/piece-azure-blob-storage`
- `bannerbear` -> `@activepieces/piece-bannerbear`
- `base44` -> `@activepieces/piece-base44`
- `baserow` -> `@activepieces/piece-baserow`
- `beehiiv` -> `@activepieces/piece-beehiiv`
- `bika` -> `@activepieces/piece-bika`
- `binance` -> `@activepieces/piece-binance`
- `blockscout` -> `@activepieces/piece-blockscout`
- `bokio` -> `@activepieces/piece-bokio`
- `browserless` -> `@activepieces/piece-browserless`
- `bubble` -> `@activepieces/piece-bubble`
- `bumpups` -> `@activepieces/piece-bumpups`
- `bursty-ai` -> `@activepieces/piece-bursty-ai`
- `buttondown` -> `@activepieces/piece-buttondown`
- `call-rounded` -> `@activepieces/piece-rounded-studio`
- `camb-ai` -> `@activepieces/piece-camb-ai`
- `carbone` -> `@activepieces/piece-carbone`
- `cartloom` -> `@activepieces/piece-cartloom`
- `chain-aware` -> `@activepieces/piece-chain-aware`
- `chaindesk` -> `@activepieces/piece-chaindesk`
- `chat-aid` -> `@activepieces/piece-chat-aid`
- `chatfly` -> `@activepieces/piece-chatfly`
- `chatsistant` -> `@activepieces/piece-chatsistant`
- `chess-com` -> `@activepieces/piece-chess-com`
- `clarifai` -> `@activepieces/piece-clarifai`
- `claude` -> `@activepieces/piece-claude`
- `clearoutphone` -> `@activepieces/piece-clearoutphone`

Manual custom auth mapping gap: none.

## Completion Claims And Remaining Proof Gates

1. **Tangle first-class connector contracts are complete.**
   All 669 catalog entries have Tangle-owned contracts. 432 use native adapter backends; 237 use package-runtime backends.

2. **Action-name mapping exists for cataloged actions.**
   Done for cataloged actions: the catalog currently has 3790 actions and 3790 upstream action-name mappings in the checked-in catalog. The runtime executor uses those names automatically and still accepts explicit `actionAliases` for overrides. Deployed smoke verification proves those names against the installed packages.

3. **Credential field mapping is complete for catalog auth setup.**
   Auth shapes are api_key: 519, oauth2: 118, none: 21, custom: 11. The catalog now includes auth field metadata for all 648 connectors that require credentials. 0 custom-auth connectors need manual auth-field mapping.

4. **Trigger contracts are complete; deployed hosting must smoke-test provider mechanics.**
   There are 998 catalog triggers and 998 upstream trigger names. The provider flow supports trigger subscribe/unsubscribe/normalize hooks. Runtime services still need live webhook/polling smoke verification.

5. **Native adapter coverage is intentionally smaller than contract breadth.**
   This repo ships 466 native adapter surfaces. 432 overlap the 669 catalog contracts; the remaining catalog contracts use package-runtime backends.

## Concrete Launch Interpretation

- It is accurate to say: **we have 669 first-class Tangle integration contracts.**
- It is accurate to say: **all product code can use one IntegrationHub/tool contract across native and package-runtime backends.**
- It is accurate to say: **deployed runtime smoke verification is the remaining proof step for package-runtime connectors.**

## Runtime Proof Gate

Run `tangle-catalog-runtime --audit-packages` inside the deployed runtime image
after installing the manifest from `--print-package-json` or
`--print-pnpm-add`. That produces the concrete package-load/action-map/trigger
surface matrix for the exact runtime image products will call. Live provider
smoke tests still require real OAuth/API-key credentials from the product
environment.
