# Adapter Triage

This is the execution-readiness map for `agent-integrations`.

The important distinction:

- `catalogOnly`: has a Tangle connector contract, but the current registry was
  not built with an execution provider for it. Good for search, planning, and
  demand capture.
- `setupReady`: has connection/setup/spec metadata. Good for OAuth/admin UI and
  generated app requirements. Still needs an executable provider.
- `gatewayExecutable`: callable through an explicitly configured gateway
  provider.
- `firstPartyExecutable`: callable through a reviewed adapter in this package.
- `sandboxExecutable`: callable directly from generated sandbox apps with a
  narrowed capability token.

Generated apps and agents should only receive executable capabilities from a
registry configured with a native adapter, gateway runtime, or sandbox runtime.

## Current First-Party Adapters

These are real adapters in `src/connectors/adapters` with read/write or event
behavior behind the `ConnectorAdapter` contract.

| Connector | Auth | Surface | Status |
| --- | --- | --- | --- |
| `google-calendar` | OAuth2 | read/write | first-party executable |
| `google-sheets` | OAuth2 | read/write | first-party executable |
| `microsoft-calendar` | OAuth2 | read/write | first-party executable |
| `hubspot` | OAuth2 | read/write | first-party executable |
| `slack` | OAuth2 | read/write | first-party executable |
| `notion-database` | OAuth2 | read/write | first-party executable |
| `salesforce` | OAuth2 | read/write | first-party executable |
| `twilio-sms` | API key | read/write | first-party executable |
| `stripe-pack` | API key | read/write | first-party executable |
| `github` | API key | read/write | first-party executable |
| `gitlab` | API key | read/write | first-party executable |
| `airtable` | API key | read/write | first-party executable |
| `asana` | API key | read/write | first-party executable |
| `webhook` | HMAC | read/write | first-party executable |
| `stripe` | HMAC | inbound events | first-party executable |
| `slack-inbound` | HMAC | inbound events | first-party executable |

Aliases matter when comparing coverage:

- `outlook-calendar` maps to `microsoft-calendar`.
- `notion` maps to `notion-database`.
- `stripe` maps to `stripe-pack` for outbound payment actions.
- `twilio` maps to `twilio-sms`.

## Direct Adapter Execution Path

Product execution goes through native `ConnectorAdapter` implementations. The
imported catalog is a coverage and backlog source, not an execution backend.

When a connector matters, add or improve a file in `src/connectors/adapters/`,
export it from `src/connectors/adapters/index.ts`, and cover the important
actions with focused adapter tests. Keep action ids stable when porting from
catalog metadata so agents and capability policies do not churn.

## Current Setup/Catalog Coverage

`listIntegrationCoverageSpecs()` currently defines 142 setup specs. The default
registry resolves all coverage IDs to setup-ready entries, including alias
lookups.

| Priority | Count | Current library status |
| --- | ---: | --- |
| Tier 0 | 38 | setup-ready specs |
| Tier 1 | 89 | setup-ready specs |
| Tier 2 | 14 | setup-ready specs |
| Long tail | 1 | setup-ready spec |

Four Tier 0 entries are canonicalized aliases:

- `outlook-calendar` should resolve to `microsoft-calendar`.
- `notion` should resolve to `notion-database`.
- `stripe` should resolve to `stripe-pack` for outbound payment actions and
  `stripe` for inbound webhooks.
- `twilio` should resolve to `twilio-sms`.

## Tier 0 Promotion Queue

### Already First-Party Executable

- Google Calendar
- Google Sheets
- Outlook Calendar / Microsoft Calendar
- Slack
- HubSpot
- Notion database
- Salesforce
- GitHub
- Airtable
- Stripe payments pack
- Twilio SMS
- Generic webhook

### Next First-Party Adapters

These are the next native adapters to implement before claiming broad direct
adapter coverage for generated agent apps.

1. Gmail: read/search/send email, thread summaries, draft/send approval path.
2. Google Drive: file search/list/download/upload, scoped file grants.
3. Outlook Mail: read/search/send email, same approval model as Gmail.
4. OneDrive: file search/list/download/upload.
5. Google Docs: read/export/create/update docs.
6. Microsoft Teams: channel/message read/write.
7. Linear: issues/projects/comments.
8. Jira: issues/projects/comments.
9. Zendesk: tickets/users/comments.
10. Intercom: conversations/contacts/messages.
11. Shopify: customers/orders/products.
12. QuickBooks: customers/invoices/payments.
13. Mailchimp: audiences/campaigns.
14. Klaviyo: profiles/events/campaign triggers.
15. Google Analytics: properties/reports.
16. Postgres: query/read/write with explicit SQL policy.
17. BigQuery: query/jobs/datasets.
18. Snowflake: query/warehouse scoped execution.
19. Amazon S3: list/get/put objects.
20. Figma: files/comments/assets.

### Setup-Ready, Use Gateway Or Declarative REST First

These are valuable, but do not need bespoke hand adapters immediately if a
gateway provider or reviewed declarative REST spec covers the first launch use
case.

- Dropbox, Box, SharePoint, Coda, Confluence
- Pipedrive, Zoho CRM, Close, Attio
- Trello, monday.com, ClickUp
- Freshdesk, Help Scout, Front, Gorgias
- Xero, NetSuite, Plaid
- WooCommerce, BigCommerce, Amazon Seller Central
- Marketo, Braze, Customer.io, SendGrid, Postmark
- Discord, Telegram, WhatsApp Business
- Facebook Pages, Instagram Business, LinkedIn, X/Twitter, YouTube
- Mixpanel, Amplitude, Segment
- Redshift, MySQL, MongoDB, Supabase, Firebase
- Google Cloud Storage, Azure Blob Storage
- Vercel, Cloudflare, Sentry, Datadog, PagerDuty
- Okta, Auth0
- Workday, BambooHR, Greenhouse, Lever, Gusto, Rippling
- DocuSign, PandaDoc, Clio, Ironclad
- Calendly, Cal.com, Zoom, Google Meet
- OpenAI, Anthropic, Gemini, Hugging Face
- Pinecone, Weaviate, Qdrant
- Typeform, Google Forms, Webflow, WordPress, Contentful, Sanity, Canva, Miro

## Product Release Gates

Before any product says an integration is “supported” for real users:

- It is exposed as `firstPartyExecutable`, `gatewayExecutable`, or
  `sandboxExecutable`.
- It has a real connection flow or gateway credential path.
- It has action input schemas good enough for LLM tool binding.
- It classifies auth, scope, rate-limit, provider outage, validation,
  approval-required, and conflict errors.
- Writes and destructive actions require approval unless explicitly allowed by
  policy.
- Mutations have idempotency or an explicit “not idempotent” guard.
- It has a healthcheck.
- It has at least one mocked unit test and one live smoke path gated by
  credentials.

## Immediate Fixes

- Include first-party adapter catalogs in registry composition when a consumer
  provides adapter instances.
- Add a generated triage command that compares coverage specs, setup specs,
  imported catalog entries, and adapter manifests.
- Promote Gmail, Drive, Outlook Mail, Linear, Jira, Zendesk, Intercom, Shopify,
  QuickBooks, S3, and Postgres first.
