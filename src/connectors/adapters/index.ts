/**
 * Concrete first-party adapter implementations.
 *
 * Every export here is either:
 *   - A factory `function fooConnector(opts) → ConnectorAdapter` for OAuth-shaped
 *     integrations (Google Calendar, Sheets, Microsoft Calendar, HubSpot, Slack,
 *     Notion). Caller resolves clientId / clientSecret from env, DB, or vault and
 *     passes them at construction.
 *   - A const `barConnector: ConnectorAdapter` for integrations that don't need
 *     hub-side OAuth client config — credentials per-connection (Twilio,
 *     Stripe-pack), HMAC-only (Webhook), or signing-secret-only inbound
 *     receivers (stripe-webhook-receiver, slack-events).
 *
 * All adapters are stateless — no module-level state, no env reads, no DB
 * coupling. Persistence + secret resolution + audit logging are the consumer's
 * concern (see the `IntegrationActionGuard` hook on the hub for cross-cutting
 * discipline).
 */

export { googleCalendar, type GoogleCalendarOptions } from './google-calendar.js'
export { googleDrive, type GoogleDriveOptions } from './google-drive.js'
export { googleSheets, type GoogleSheetsOptions } from './google-sheets.js'
export { gmail, type GmailOptions } from './gmail.js'
export { microsoftCalendar, type MicrosoftCalendarOptions } from './microsoft-calendar.js'
export { hubspot, type HubSpotOptions } from './hubspot.js'
export { slack, type SlackOptions } from './slack.js'
export { notionDatabase, type NotionDatabaseOptions } from './notion-database.js'
export { docuseal, type DocuSealOptions } from './docuseal.js'
export {
  declarativeRestConnector,
  type RestConnectorSpec,
  type RestOperationSpec,
  type RestRequestSpec,
  type RestCredentialPlacement,
} from './declarative-rest.js'

export { twilioSmsConnector } from './twilio-sms.js'
export { whatsappBusiness, type WhatsappBusinessOptions } from './whatsapp-business.js'
export { stripePackConnector } from './stripe-pack.js'
export { webhookConnector } from './webhook.js'
export { stripeWebhookReceiverConnector } from './stripe-webhook-receiver.js'
export { slackEventsConnector } from './slack-events.js'
export { githubConnector } from './github.js'
export { gitlabConnector } from './gitlab.js'
export { airtableConnector } from './airtable.js'
export { asanaConnector } from './asana.js'
export { salesforceConnector } from './salesforce.js'
export { firebaseConnector } from './firebase.js'
export { supabaseConnector } from './supabase.js'
export { discordConnector } from './discord.js'
export { facebookPagesConnector } from './facebook-pages.js'
export { telegramConnector, TELEGRAM_FILE_DOWNLOAD_ROOT } from './telegram.js'

// === Mega fan-out (2026-05-31): native adapter expansion ===
// 24 declarative-REST OAuth2 connectors (use declarativeRestConnector internally)
// CRM family
export { pipedriveConnector } from './pipedrive.js'
export { closeConnector } from './close.js'
export { zohoCrmConnector } from './zoho-crm.js'
export { attioConnector } from './attio.js'
// Finance / accounting
export { quickbooksConnector } from './quickbooks.js'
export { xeroConnector } from './xero.js'
// HR / payroll
export { gustoConnector } from './gusto.js'
// Commerce
export { bigcommerceConnector } from './bigcommerce.js'
export { shopifyConnector } from './shopify.js'
export { ebayConnector } from './ebay.js'
export { etsyConnector, type EtsyOptions } from './etsy.js'
// Support desks
export { zendeskConnector } from './zendesk.js'
export { intercomConnector } from './intercom.js'
export { helpscoutConnector } from './helpscout.js'
export { frontConnector } from './front.js'
export { gorgiasConnector } from './gorgias.js'
// Email / marketing
export { mailchimpConnector } from './mailchimp.js'
export { klaviyoConnector } from './klaviyo.js'
export { sendgridConnector } from './sendgrid.js'
export { postmarkConnector } from './postmark.js'
export { marketoConnector } from './marketo.js'
export { brazeConnector } from './braze.js'
export { customerIoConnector } from './customer-io.js'
// Scheduling
export { calComConnector } from './cal-com.js'
export { calendlyConnector } from './calendly.js'
// Content
export { contentfulConnector } from './contentful.js'
export { sanityConnector } from './sanity.js'
export { codaConnector } from './coda.js'
export { webflowConnector } from './webflow.js'
export { wordpressConnector } from './wordpress.js'
// Atlassian
export { confluenceConnector } from './confluence.js'
// E-signature
export { docusignConnector } from './docusign.js'
// Design
export { figmaConnector } from './figma.js'
export { figjamConnector } from './figjam.js'
export { miroConnector } from './miro.js'
export { canvaConnector } from './canva.js'
// Storage
export { boxConnector } from './box.js'
export { dropboxConnector } from './dropbox.js'
export { adobeCreativeCloudConnector } from './adobe-creative-cloud.js'
// Project management
export { linearConnector } from './linear.js'
export { trelloConnector } from './trello.js'
export { mondayConnector } from './monday.js'
export { clickupConnector } from './clickup.js'
export { basecampConnector } from './basecamp.js'
// Legal practice management
export { clioConnector } from './clio.js'
// Observability / errors
export { sentryConnector } from './sentry.js'
export { datadogConnector } from './datadog.js'
// Incident response / on-call
export { pagerdutyConnector } from './pagerduty.js'
export { opsgenieConnector } from './opsgenie.js'
// Identity / auth
export { auth0Connector } from './auth0.js'
// AI / LLM providers
export { openaiConnector } from './openai.js'
export { anthropicConnector } from './anthropic.js'
export { geminiConnector } from './gemini.js'
export { huggingfaceConnector } from './huggingface.js'
// Vector databases
export { weaviateConnector } from './weaviate.js'
export { pineconeConnector } from './pinecone.js'
export { qdrantConnector } from './qdrant.js'
// HRIS
export { bamboohrConnector } from './bamboohr.js'
export { ripplingConnector } from './rippling.js'
export { workdayConnector } from './workday.js'
// ATS / recruiting
export { leverConnector } from './lever.js'
export { greenhouseConnector } from './greenhouse.js'
// Deployment platforms
export { vercelConnector } from './vercel.js'
export { netlifyConnector } from './netlify.js'
// Forms
export { typeformConnector } from './typeform.js'

// 8 factory-style adapters (need client credentials at construction)
export { hellosign, type HelloSignOptions } from './hellosign.js'
export { pandadoc, type PandaDocOptions } from './pandadoc.js'
export { googleDocs, type GoogleDocsOptions } from './google-docs.js'
export { googleForms, type GoogleFormsOptions } from './google-forms.js'
export { microsoftGraph, type MicrosoftGraphOptions } from './microsoft-graph.js'
export { outlookMail, type OutlookMailOptions } from './outlook-mail.js'
export { microsoftTeams, type MicrosoftTeamsOptions } from './microsoft-teams.js'
export { oneDrive, type OneDriveOptions } from './onedrive.js'
export { sharepoint, type SharePointOptions } from './sharepoint.js'

export {
  tangleIdentity,
  createTangleIdentityClient,
  DEFAULT_TANGLE_PLATFORM_URL,
  TANGLE_API_KEY_PREFIX,
  TANGLE_SERVICE_TOKEN_PREFIX,
  TangleIdentityUnreachableError,
  type TangleIdentityClient,
  type TangleIdentityOptions,
  type TangleTokenVerifyFailure,
  type TangleTokenVerifyResult,
  type TangleUserSummary,
  type TangleWorkspaceSummary,
} from './tangle-id.js'
