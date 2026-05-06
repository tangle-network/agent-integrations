# Integration Coverage Checklist

Goal: cover the integrations that make agents useful for 99% of practical product workflows: ingesting data, searching context, drafting or updating records, triggering workflows, and safely performing writes with approval.

## Strategy

- Use `buildIntegrationCoverageConnectors()` for broad planning/catalog coverage.
- Use hosted gateways, imported connector catalogs, and custom HTTP providers for long-tail OAuth/API coverage.
- Implement high-volume, sensitive, or moat-critical connectors as native `ConnectorAdapter`s.
- Do not claim a connector is executable until it has auth, scope, action, error, rate-limit, idempotency, and approval-path tests.
- Keep every connector behind `IntegrationHub`, capability tokens, policy checks, and sandbox invocation envelopes.

## Release Gates

- [x] One normalized connector contract for apps, sandboxes, and agents.
- [x] Central sandbox invocation envelope validation.
- [x] Coverage catalog for 100+ high-value integrations.
- [x] Builder API consumes the coverage catalog for app planning.
- [x] Declarative REST adapter factory for fast native implementation of REST-shaped APIs.
- [x] Provider gateway catalog adapter can normalize 500+ external catalog connectors.
- [x] Canonical registry dedupes overlapping catalogs, aliases, support tiers, and conflict diagnostics.
- [ ] Generated sandbox apps can request missing connections from the catalog.
- [ ] Live smoke credentials exist for Tier 0 connectors.
- [ ] Tier 0 connector failures are classified by auth, scope, rate-limit, provider outage, validation, approval, and conflict.
- [ ] Tier 0 write actions have idempotency and approval tests.
- [x] Provider gateway adapters can import/sync catalog metadata from external registries.
- [x] Adapter execution triage is documented in [`adapter-triage.md`](./adapter-triage.md).
- [x] Tangle Integrations Catalog contracts can execute through `createTangleCatalogExecutorProvider`.
- [x] Tangle Integrations Catalog executable actions can dispatch through a signed HTTP runtime executor protocol.

## Tier 0 First-Party Promotion Queue

- [x] Google Calendar
- [x] Google Sheets
- [x] Slack
- [x] HubSpot
- [x] Notion database
- [x] Stripe payments pack
- [x] Twilio SMS
- [x] Generic webhook
- [ ] Gmail
- [ ] Outlook Mail
- [x] Outlook Calendar via `microsoft-calendar`
- [ ] Google Drive
- [ ] Google Docs
- [ ] Microsoft Teams
- [ ] OneDrive
- [x] Airtable
- [x] Salesforce
- [ ] Linear
- [ ] Jira
- [x] GitHub
- [ ] Zendesk
- [ ] Intercom
- [ ] QuickBooks
- [ ] Shopify
- [ ] Mailchimp
- [ ] Klaviyo
- [ ] Google Analytics
- [ ] Snowflake
- [ ] BigQuery
- [ ] Postgres
- [ ] Amazon S3
- [ ] Calendly
- [ ] Zoom
- [ ] Microsoft Graph broader graph pack
- [ ] OpenAI
- [ ] Figma

## Coverage Catalog

The exhaustive checklist is generated from `integrationCoverageChecklistMarkdown()`. Current catalog scope includes:

- Email and calendar: Gmail, Outlook, Google Calendar, Outlook Calendar, Calendly, Zoom.
- Collaboration: Slack, Teams, Discord, Telegram, WhatsApp Business.
- Knowledge and files: Google Drive, OneDrive, Dropbox, Box, Google Docs, Notion, Confluence, SharePoint.
- CRM and support: HubSpot, Salesforce, Pipedrive, Zoho, Zendesk, Intercom, Freshdesk, Help Scout, Front.
- Project and dev: Linear, Jira, GitHub, GitLab, Asana, Trello, ClickUp, Sentry, Datadog, PagerDuty.
- Commerce and finance: Stripe, QuickBooks, Xero, NetSuite, Shopify, WooCommerce, Amazon Seller Central.
- Marketing and social: Mailchimp, Klaviyo, Marketo, Braze, Facebook Pages, Instagram Business, LinkedIn, X, YouTube.
- Data and infra: Snowflake, BigQuery, Redshift, Postgres, MySQL, MongoDB, Supabase, Firebase, S3, Cloudflare.
- HR/legal/signature: Workday, BambooHR, Greenhouse, Lever, Gusto, Rippling, DocuSign, Ironclad, Clio.
- AI/vector/workflow: OpenAI, Anthropic, Gemini, Hugging Face, Pinecone, Weaviate, Qdrant, Zapier, Make, hosted gateways, and imported automation catalogs.

## Remaining Work

- [ ] Wire Builder to show Tier 0 missing connections from the coverage catalog.
- [ ] Add Gmail first-party adapter.
- [x] Add GitHub first-party adapter.
- [x] Add Salesforce or Zendesk first-party adapter.
- [x] Add reusable declarative REST adapter factory.
- [x] Add Airtable, GitLab, and Asana via declarative REST.
- [x] Add generated integration setup specs, renderers, validation, and healthcheck plans.
- [ ] Add live smoke-test harness that skips only when explicit credentials are absent.
- [ ] Add gateway sync job for external catalog metadata.
