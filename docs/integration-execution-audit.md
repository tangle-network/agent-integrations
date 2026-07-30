# Integration Execution Audit

Generated from the current checkout by `node scripts/audit-integration-execution.mjs`.

This audit separates product contracts from implementation backends:

- **Tangle contract**: the connector has a Tangle-owned action/trigger/auth contract.
- **Setup-ready**: we have setup/auth/runbook metadata for product UI and admin configuration.
- **Native adapter backend**: this repo ships a reviewed direct adapter implementation.
- **Native adapter backlog**: a connector contract exists, but product-grade direct execution still needs a reviewed adapter.

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
| Setup specs | 184 |
| Executable setup specs | 147 |
| Catalog/setup-only specs | 37 |
| Tangle first-class contracts | 669 |
| Contracts with runtime packages | 669 |
| Contracts with mapped actions | 669 |
| Contracts with mapped triggers | 669 |
| Contracts with mapped auth | 669 |
| Native adapter backends | 446 |
| Native adapter surfaces shipped | 545 |
| Package-runtime backends | 223 |
| Runtime manifest dependencies for catalog-only connectors | 224 |
| Catalog-only connectors exposable behind runtime | 223 |
| Catalog-only actions exposable behind runtime | 955 |

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
- `adobe-sign`
- `adp`
- `affinity`
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
- `amazon-s3`
- `amazon-secrets-manager`
- `amazon-ses`
- `amazon-sns`
- `amazon-sqs`
- `amazon-textract`
- `aminos`
- `ampeco`
- `amplemarket`
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
- `autobound`
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
- `bettercontact`
- `bettermode`
- `bexio`
- `bigcommerce`
- `bigin-by-zoho`
- `bill-com`
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
- `brex`
- `brightdata`
- `brilliant-directories`
- `browse-ai`
- `builtwith`
- `cal-com`
- `calendly`
- `campaign-monitor`
- `canny`
- `canva`
- `capsule-crm`
- `captain-data`
- `cashfree-payments`

...and 465 more native adapter surfaces.

Executable setup specs:

- `adobe-creative-cloud`
- `affinity`
- `aircall`
- `airtable`
- `amazon-s3`
- `amazon-sns`
- `amazon-sqs`
- `anthropic`
- `asana`
- `attio`
- `auth0`
- `bamboohr`
- `basecamp`
- `bigcommerce`
- `bill-com`
- `box`
- `braze`
- `brex`
- `cal-com`
- `calendly`
- `canva`
- `chargebee`
- `clickup`
- `clio`
- `close`
- `coda`
- `confluence`
- `contentful`
- `customer-io`
- `datadog`
- `dialpad`
- `discord`
- `docusign`
- `dropbox`
- `ebay`
- `etsy`
- `facebook-pages`
- `fathom`
- `figjam`
- `figma`
- `firebase`
- `fireflies-ai`
- `freshdesk`
- `front`
- `gemini`
- `github`
- `gitlab`
- `gmail`
- `gong`
- `google-analytics`
- `google-calendar`
- `google-cloud-storage`
- `google-contacts`
- `google-docs`
- `google-drive`
- `google-forms`
- `google-meet`
- `google-sheets`
- `google-slides`
- `google-tasks`
- `googlechat`
- `gorgias`
- `granola`
- `greenhouse`
- `gusto`
- `hellosign`
- `helpscout`
- `http`
- `hubspot`
- `huggingface`
- `intercom`
- `ironclad`
- `jotform`
- `klaviyo`
- `lever`
- `linear`
- `mailchimp`
- `make`
- `marketo`
- `microsoft-365-people`
- `microsoft-365-planner`
- `microsoft-calendar`
- `microsoft-dynamics-365-business-central`
- `microsoft-dynamics-crm`
- `microsoft-excel-365`
- `microsoft-graph`
- `microsoft-onenote`
- `microsoft-power-bi`
- `microsoft-teams`
- `microsoft-todo`
- `miro`
- `mixpanel`
- `monday`
- `mongodb`
- `netlify`
- `netsuite`
- `notion`
- `onedrive`
- `open-phone`
- `openai`
- `opsgenie`
- `outlook-mail`
- `paddle`
- `pagerduty`
- `pandadoc`
- `phony`
- `pinecone`
- `pipedream`
- `pipedrive`
- `plaid`
- `postgres`
- `postmark`
- `qdrant`
- `quickbooks`
- `ramp`
- `ringcentral`
- `rippling`
- `rss`
- `sage-intacct`
- `salesforce`
- `sanity`
- `sendgrid`
- `sentry`
- `sharepoint`
- `shopify`
- `slack`
- `snowflake`
- `stripe-pack`
- `supabase`
- `telegram`
- `trello`
- `twilio-sms`
- `typeform`
- `vercel`
- `weaviate`
- `webflow`
- `webhook`
- `whatsapp-business`
- `woocommerce`
- `wordpress`
- `workday`
- `xero`
- `youtube`
- `zapier`
- `zendesk`
- `zoho-crm`
- `zoom`

## Flow Readiness

| Flow | Status | Concrete state |
| --- | --- | --- |
| Tangle first-class contracts | Done | 669 connectors have Tangle-owned action/trigger/auth/runtime contracts. |
| Connector discovery/catalog search | Done | 669 catalog connectors, 3790 actions, 998 triggers normalized into Tangle catalog shapes. |
| Native adapter execution | Done for listed native backends | 545 reviewed native adapter surfaces ship from this package; 446 overlap the 669 catalog contracts. |
| OAuth/API-key setup metadata | Partial | 184 setup specs exist; 147 are executable setup specs and 37 are catalog/setup-only. |
| Direct adapter backlog | Tracked | 223 contracts still need native/direct adapters before they should be product-executable. |
| Legacy runtime dependency manifest | Deprecated | `buildTangleCatalogRuntimePackageManifest()` is retained only as an audit/provenance helper; products should not deploy a package runner for normal execution. |
| Runtime package coverage audit | Removed from launch path | Package-runner smoke is no longer a product launch gate; port demanded integrations to direct adapters instead. |
| Long-tail credential mapping | Mostly mapped | 648 connectors have auth field metadata. 0 custom-auth connectors still need exact manual auth fields. |
| Trigger provider flow | Done structurally | 998 triggers are cataloged, 998 have upstream names, and catalog providers can route subscribe/unsubscribe/normalize hooks. Runtime services still need package-specific trigger hosting. |
| Sandbox/app invocation envelope | Done | The library has capability bundles, invocation envelopes, policy checks, guard hooks, and generated-app client helpers. |
| Live provider smoke tests | Not globally done | First-party adapters can be tested by consumers with credentials; long-tail smoke matrix is not generated yet. |

## Concrete Not-Done Buckets

| Bucket | Count | What it means |
| --- | ---: | --- |
| Contracts needing native/direct adapters | 223 | Connector has a Tangle contract but no reviewed direct adapter yet. |
| Commercial/setup-only provider contracts | 31 | Provider is discoverable with honest setup metadata but cannot execute until a supported API backend and customer credentials exist. |
| Catalog connectors with zero upstream action names | 0 | These entries need catalog action-name mapping before exact package-runtime invocation can work. |
| Custom-auth catalog connectors needing manual credential-field mapping | 0 | These are still custom auth and no field names were extracted from source. |
| Catalog connectors with triggers needing runtime-service hosting | 288 | Trigger metadata and provider hooks exist; runtime services still need package-specific webhook/polling hosting. |

Examples needing native/direct adapter ports:

- `activepieces` -> `@activepieces/piece-activepieces`
- `actualbudget` -> `@activepieces/piece-actualbudget`
- `acuity-scheduling` -> `@activepieces/piece-acuity-scheduling`
- `ai` -> `@activepieces/piece-ai`
- `aianswer` -> `@activepieces/piece-aianswer`
- `airparser` -> `@activepieces/piece-airparser`
- `algolia` -> `@activepieces/piece-algolia`
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
- `clickfunnels` -> `@activepieces/piece-clickfunnels`

Manual custom auth mapping gap: none.

## Completion Claims And Remaining Proof Gates

1. **Tangle first-class connector contracts are complete.**
   All 669 catalog entries have Tangle-owned contracts. 446 use native adapter backends; 223 are backlog for native ports.

2. **Action-name mapping exists for cataloged actions.**
   Done for cataloged actions: the catalog currently has 3790 actions and 3790 upstream action-name mappings in the checked-in catalog. Direct adapters should preserve stable Tangle action ids when porting demanded backlog connectors.

3. **Credential field mapping is complete for catalog auth setup.**
   Auth shapes are api_key: 519, oauth2: 118, none: 21, custom: 11. The catalog now includes auth field metadata for all 648 connectors that require credentials. 0 custom-auth connectors need manual auth-field mapping.

4. **Trigger contracts are complete; deployed hosting must smoke-test provider mechanics.**
   There are 998 catalog triggers and 998 upstream trigger names. The provider flow supports trigger subscribe/unsubscribe/normalize hooks. Runtime services still need live webhook/polling smoke verification.

5. **Native adapter coverage is intentionally smaller than contract breadth.**
   This repo ships 545 native adapter surfaces. 446 overlap the 669 catalog contracts; the remaining catalog contracts are not product-executable until ported.

## Concrete Launch Interpretation

- It is accurate to say: **we have 669 first-class Tangle integration contracts.**
- It is accurate to say: **product execution should use direct/native adapters.**
- It is accurate to say: **the remaining 223 catalog-only contracts are backlog, not runtime-ready product surface.**

## Native Port Gate

Port high-demand backlog connectors into `src/connectors/adapters/`, export
them from `src/connectors/adapters/index.ts`, add focused adapter tests, and
rerun this audit. Live provider smoke tests still require real OAuth/API-key
credentials from the product environment.
