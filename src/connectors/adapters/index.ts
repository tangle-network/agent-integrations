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
