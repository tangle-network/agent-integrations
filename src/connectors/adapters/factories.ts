import type { ConnectorAdapter } from '../types.js'
import { oktaConnector } from './okta.js'
import { oneloginConnector } from './onelogin.js'
import { pingIdentityConnector } from './ping-identity.js'
import { scimConnector } from './scim.js'
import { actualbudgetConnector } from './actualbudget.js'
import { aianswerConnector } from './aianswer.js'
import { airparserConnector } from './airparser.js'
import { anyhookWebsocketConnector } from './anyhook-websocket.js'
import { apifyConnector } from './apify.js'
import { askHandleConnector } from './ask-handle.js'
import { bannerbearConnector } from './bannerbear.js'
import { base44Connector } from './base44.js'
import { beehiivConnector } from './beehiiv.js'
import { bikaConnector } from './bika.js'
import { buttondownConnector } from './buttondown.js'
import { cambAiConnector } from './camb-ai.js'
import { cartloomConnector } from './cartloom.js'
import { csvFilesConnector } from './csv-files.js'
import { chainAwareConnector } from './chain-aware.js'
import { chaindeskConnector } from './chaindesk.js'
import { chatAidConnector } from './chat-aid.js'
import { chatsistantConnector } from './chatsistant.js'
import { claudeConnector } from './claude.js'
import { clearoutphoneConnector } from './clearoutphone.js'
import { clickfunnelsConnector } from './clickfunnels.js'
import { codyConnector } from './cody.js'
import { contextualAiConnector } from './contextual-ai.js'
import { contiguityConnector } from './contiguity.js'
import { couchbaseConnector } from './couchbase.js'
import { dappierConnector } from './dappier.js'
import { deepgramConnector } from './deepgram.js'
import { detectingAiConnector } from './detecting-ai.js'
import { digitalPilotConnector } from './digital-pilot.js'
import { duckdbConnector } from './duckdb.js'
import { docsbotConnector } from './docsbot.js'
import { dripConnector } from './drip.js'
import { echowinConnector } from './echowin.js'
import { elevenlabsConnector } from './elevenlabs.js'
import { excelFilesConnector } from './excel-files.js'
import { everhourConnector } from './everhour.js'
import { featheryConnector } from './feathery.js'
import { fellowConnector } from './fellow.js'
import { flowParserConnector } from './flow-parser.js'
import { gammaConnector } from './gamma.js'
import { genderApiConnector } from './gender-api.js'
import { generatebannersConnector } from './generatebanners.js'
import { giftbitConnector } from './giftbit.js'
import { modelslabConnector } from './modelslab.js'
import { adobeSignConnector } from './adobe-sign.js'
import { aircallConnector } from './aircall.js'
import { affinityConnector } from './affinity.js'
import { amazonEventBridgeConnector } from './amazon-eventbridge.js'
import { amazonS3Connector } from './amazon-s3.js'
import { amazonSnsConnector } from './amazon-sns.js'
import { amazonSqsConnector } from './amazon-sqs.js'
import { asanaConnector } from './asana.js'
import { attioConnector } from './attio.js'
import { auth0Connector } from './auth0.js'
import { acuitySchedulingConnector } from './acuity-scheduling.js'
import { avomaConnector } from './avoma.js'
import { avalaraConnector } from './avalara.js'
import { azureAdConnector } from './azure-ad.js'
import { azureBlobStorageConnector } from './azure-blob-storage.js'
import { azureEventGridConnector } from './azure-event-grid.js'
import { azureServiceBusConnector } from './azure-service-bus.js'
import { basecampConnector } from './basecamp.js'
import { backblazeConnector } from './backblaze.js'
import { biginByZohoConnector } from './bigin-by-zoho.js'
import { boxConnector } from './box.js'
import { baremetricsConnector } from './baremetrics.js'
import { brexConnector } from './brex.js'
import { billComConnector } from './bill-com.js'
import { billplzConnector } from './billplz.js'
import { calComConnector } from './cal-com.js'
import { calendlyConnector } from './calendly.js'
import { capsuleCrmConnector } from './capsule-crm.js'
import { closeConnector } from './close.js'
import { clickupConnector } from './clickup.js'
import { cloudinaryConnector } from './cloudinary.js'
import { codaConnector } from './coda.js'
import { confluenceConnector } from './confluence.js'
import { contentfulConnector } from './contentful.js'
import { copperConnector } from './copper.js'
import { chargebeeConnector } from './chargebee.js'
import { recurlyConnector } from './recurly.js'
import { taxjarConnector } from './taxjar.js'
import { cashfreePaymentsConnector } from './cashfree-payments.js'
import { circleConnector } from './circle.js'
import { checkoutConnector } from './checkout.js'
import { chessComConnector } from './chess-com.js'
import { docuseal, type DocuSealOptions } from './docuseal.js'
import { docusignConnector } from './docusign.js'
import { dialpadConnector } from './dialpad.js'
import { dropboxConnector } from './dropbox.js'
import { etsyConnector, type EtsyOptions } from './etsy.js'
import { fathomConnector } from './fathom.js'
import { fireberryConnector } from './fireberry.js'
import { firefliesAiConnector } from './fireflies-ai.js'
import { filloutFormsConnector } from './fillout-forms.js'
import { flowluConnector } from './flowlu.js'
import { folkConnector } from './folk.js'
import { freshdeskConnector } from './freshdesk.js'
import { freshsalesConnector } from './freshsales.js'
import { frontConnector } from './front.js'
import { gmail, type GmailOptions } from './gmail.js'
import { gongConnector } from './gong.js'
import { gorgiasConnector } from './gorgias.js'
import {
  googleCalendar,
  type GoogleCalendarOptions,
} from './google-calendar.js'
import { googleCloudStorageConnector } from './google-cloud-storage.js'
import { googlePubSubConnector } from './google-pubsub.js'
import { googleContactsConnector } from './google-contacts.js'
import { googleDocs, type GoogleDocsOptions } from './google-docs.js'
import { googleDrive, type GoogleDriveOptions } from './google-drive.js'
import { googleForms, type GoogleFormsOptions } from './google-forms.js'
import { googleSheets, type GoogleSheetsOptions } from './google-sheets.js'
import { googleSlidesConnector } from './google-slides.js'
import { googleTasksConnector } from './google-tasks.js'
import { googlechatConnector } from './googlechat.js'
import { granolaConnector } from './granola.js'
import { hellosign, type HelloSignOptions } from './hellosign.js'
import { helpscoutConnector } from './helpscout.js'
import { hubspot, type HubSpotOptions } from './hubspot.js'
import { httpConnector } from './http.js'
import { intercomConnector } from './intercom.js'
import { instagramBusinessConnector } from './instagram-business.js'
import { insightlyConnector } from './insightly.js'
import { invoiceninjaConnector } from './invoiceninja.js'
import { ironcladConnector } from './ironclad.js'
import { jiraCloudConnector } from './jira-cloud.js'
import { jotformConnector } from './jotform.js'
import { justcallConnector } from './justcall.js'
import { kafkaConnector } from './kafka.js'
import { leadConnectorConnector } from './lead-connector.js'
import { lemonSqueezyConnector } from './lemon-squeezy.js'
import { linearConnector } from './linear.js'
import { linkedinConnector } from './linkedin.js'
import { makeConnector } from './make.js'
import {
  microsoft365PeopleConnector,
} from './microsoft-365-people.js'
import {
  microsoft365PlannerConnector,
} from './microsoft-365-planner.js'
import {
  microsoftCalendar,
  type MicrosoftCalendarOptions,
} from './microsoft-calendar.js'
import { microsoftDynamics365BusinessCentralConnector } from './microsoft-dynamics-365-business-central.js'
import { microsoftDynamicsCrmConnector } from './microsoft-dynamics-crm.js'
import { microsoftExcel365Connector } from './microsoft-excel-365.js'
import {
  microsoftGraph,
  type MicrosoftGraphOptions,
} from './microsoft-graph.js'
import {
  microsoftTeams,
  type MicrosoftTeamsOptions,
} from './microsoft-teams.js'
import { microsoftOnenoteConnector } from './microsoft-onenote.js'
import { microsoftPowerBiConnector } from './microsoft-power-bi.js'
import { microsoftTodoConnector } from './microsoft-todo.js'
import { mastodonConnector } from './mastodon.js'
import { meetgeekAiConnector } from './meetgeek-ai.js'
import { mollieConnector } from './mollie.js'
import { mondayConnector } from './monday.js'
import { mycaseConnector } from './mycase.js'
import { notion, type NotionOptions } from './notion.js'
import { n8nConnector } from './n8n.js'
import { netsuiteConnector } from './netsuite.js'
import { ninjapipeConnector } from './ninjapipe.js'
import { openPhoneConnector } from './open-phone.js'
import { oneDrive, type OneDriveOptions } from './onedrive.js'
import { oneSpanSignConnector } from './onespan-sign.js'
import { outlookMail, type OutlookMailOptions } from './outlook-mail.js'
import { pandadoc, type PandaDocOptions } from './pandadoc.js'
import { paddleConnector } from './paddle.js'
import { plaidConnector } from './plaid.js'
import { pipedreamConnector } from './pipedream.js'
import { pipedriveConnector } from './pipedrive.js'
import { parquetFilesConnector } from './parquet-files.js'
import { quickbooksConnector } from './quickbooks.js'
import { rabbitMqConnector } from './rabbitmq.js'
import { recallAiConnector } from './recall-ai.js'
import { rampConnector } from './ramp.js'
import { ringcentralConnector } from './ringcentral.js'
import { rssConnector } from './rss.js'
import { salesforceConnector } from './salesforce.js'
import { sftpConnector } from './sftp.js'
import { saleorConnector } from './saleor.js'
import { savvycalConnector } from './savvycal.js'
import { sharepoint, type SharePointOptions } from './sharepoint.js'
import { shippoConnector } from './shippo.js'
import { signNowConnector } from './sign-now.js'
import { slack, type SlackOptions } from './slack.js'
import { sageIntacctConnector } from './sage-intacct.js'
import { shopifyConnector } from './shopify.js'
import { squareConnector } from './square.js'
import { stripePackConnector } from './stripe-pack.js'
import { tallyConnector } from './tally.js'
import { tlDvConnector } from './tl-dv.js'
import { todoistConnector } from './todoist.js'
import { trelloConnector } from './trello.js'
import { twentyConnector } from './twenty.js'
import { typeformConnector } from './typeform.js'
import { twitter, type TwitterOptions } from './twitter.js'
import { twilioSmsConnector } from './twilio-sms.js'
import { voucheryIoConnector } from './vouchery-io.js'
import {
  whatsappBusiness,
  type WhatsappBusinessOptions,
} from './whatsapp-business.js'
import { xeroConnector } from './xero.js'
import { webflowConnector } from './webflow.js'
import { wordpressConnector } from './wordpress.js'
import { youtubeDataConnector } from './youtube-data.js'
import { zapierConnector } from './zapier.js'
import { zendeskConnector } from './zendesk.js'
import { zoomConnector } from './zoom.js'
import { zohoBookingsConnector } from './zoho-bookings.js'
import { zohoDeskConnector } from './zoho-desk.js'
import { zohoCrmConnector } from './zoho-crm.js'
import { zohoBooksConnector } from './zoho-books.js'
import { zohoCampaignsConnector } from './zoho-campaigns.js'
import { zohoInvoiceConnector } from './zoho-invoice.js'
import { zohoMailConnector } from './zoho-mail.js'
import { apolloConnector } from './apollo.js'
import { brazeConnector } from './braze.js'
import { customerIoConnector } from './customer-io.js'
import { klaviyoConnector } from './klaviyo.js'
import { lemlistConnector } from './lemlist.js'
import { mailchimpConnector } from './mailchimp.js'
import { marketoConnector } from './marketo.js'
import { outreachConnector } from './outreach.js'
import { salesloftConnector } from './salesloft.js'
import { smartleadConnector } from './smartlead.js'
import { chatwootConnector } from './chatwoot.js'
import { matrixConnector } from './matrix.js'
import { mattermostConnector } from './mattermost.js'
import { telegramConnector } from './telegram.js'
import { airtableConnector } from './airtable.js'
import { baserowConnector } from './baserow.js'
import { datadogConnector } from './datadog.js'
import { discourseConnector } from './discourse.js'
import { digitalOceanConnector } from './digital-ocean.js'
import { clicksendConnector } from './clicksend.js'
import { firebaseConnector } from './firebase.js'
import { googleBigqueryConnector } from './google-bigquery.js'
import { hightouchConnector } from './hightouch.js'
import { metabaseConnector } from './metabase.js'
import { mysqlConnector } from './mysql.js'
import { segmentConnector } from './segment.js'
import { supabaseConnector } from './supabase.js'
import { builtwithConnector } from './builtwith.js'
import { fullenrichConnector } from './fullenrich.js'
import { hunterConnector } from './hunter.js'
import { neverbounceConnector } from './neverbounce.js'
import { theirstackConnector } from './theirstack.js'
import { zerobounceConnector } from './zerobounce.js'

export type ConnectorAdapterFactoryEnvNames =
  | string
  | readonly string[]

export interface ConnectorAdapterFactoryDefinition {
  readonly kind: string
  readonly factory: (
    options: Readonly<Record<string, string>>,
  ) => ConnectorAdapter
  readonly envMap: Readonly<
    Record<string, ConnectorAdapterFactoryEnvNames>
  >
}

function defineFactoryAdapter<TOptions extends object>(
  factory: (options: TOptions) => ConnectorAdapter,
  envMap: Readonly<Record<string, ConnectorAdapterFactoryEnvNames>>,
): ConnectorAdapterFactoryDefinition {
  const metadataOptions = Object.fromEntries(
    Object.keys(envMap).map((name) => [name, `tangle-adapter-metadata-${name}`]),
  ) as TOptions
  const kind = factory(metadataOptions).manifest.kind
  if (!kind) {
    throw new Error('Connector adapter factory returned an empty manifest kind')
  }
  return {
    kind,
    factory: (options) => factory(options as TOptions),
    envMap,
  }
}

const googleOAuthEnvMap = {
  clientId: 'GOOGLE_OAUTH_CLIENT_ID',
  clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET',
} as const

const microsoftOAuthEnvMap = {
  clientId: ['MICROSOFT_OAUTH_CLIENT_ID', 'MS_OAUTH_CLIENT_ID'],
  clientSecret: [
    'MICROSOFT_OAUTH_CLIENT_SECRET',
    'MS_OAUTH_CLIENT_SECRET',
  ],
} as const

const zohoOAuthEnvMap = {
  clientId: [
    'ZOHO_OAUTH_CLIENT_ID',
    'ZOHO_CRM_OAUTH_CLIENT_ID',
    'BIGIN_BY_ZOHO_OAUTH_CLIENT_ID',
  ],
  clientSecret: [
    'ZOHO_OAUTH_CLIENT_SECRET',
    'ZOHO_CRM_OAUTH_CLIENT_SECRET',
    'BIGIN_BY_ZOHO_OAUTH_CLIENT_SECRET',
  ],
} as const

/**
 * Credential-dependent adapter factories and their deployment configuration.
 *
 * This is the only factory inventory. Products and the platform consume it
 * instead of repeating provider lists or environment-variable mappings.
 */
export const CONNECTOR_ADAPTER_FACTORIES: readonly ConnectorAdapterFactoryDefinition[] =
  [
    defineFactoryAdapter<GoogleCalendarOptions>(
      googleCalendar,
      googleOAuthEnvMap,
    ),
    defineFactoryAdapter<GoogleSheetsOptions>(
      googleSheets,
      googleOAuthEnvMap,
    ),
    defineFactoryAdapter<GmailOptions>(gmail, googleOAuthEnvMap),
    defineFactoryAdapter<GoogleDriveOptions>(
      googleDrive,
      googleOAuthEnvMap,
    ),
    defineFactoryAdapter<GoogleDocsOptions>(googleDocs, googleOAuthEnvMap),
    defineFactoryAdapter<GoogleFormsOptions>(
      googleForms,
      googleOAuthEnvMap,
    ),
    defineFactoryAdapter(() => googleContactsConnector, googleOAuthEnvMap),
    defineFactoryAdapter(() => googleSlidesConnector, googleOAuthEnvMap),
    defineFactoryAdapter(() => googlechatConnector, googleOAuthEnvMap),
    defineFactoryAdapter(() => googleTasksConnector, googleOAuthEnvMap),
    defineFactoryAdapter<SlackOptions>(slack, {
      clientId: 'SLACK_OAUTH_CLIENT_ID',
      clientSecret: 'SLACK_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => telegramConnector, {}),
    defineFactoryAdapter(() => mattermostConnector, {}),
    defineFactoryAdapter(() => matrixConnector, {}),
    defineFactoryAdapter(() => chatwootConnector, {}),
    defineFactoryAdapter<HubSpotOptions>(hubspot, {
      clientId: 'HUBSPOT_OAUTH_CLIENT_ID',
      clientSecret: 'HUBSPOT_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter<NotionOptions>(notion, {
      clientId: 'NOTION_OAUTH_CLIENT_ID',
      clientSecret: 'NOTION_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter<MicrosoftCalendarOptions>(
      microsoftCalendar,
      microsoftOAuthEnvMap,
    ),
    defineFactoryAdapter<MicrosoftGraphOptions>(
      microsoftGraph,
      microsoftOAuthEnvMap,
    ),
    defineFactoryAdapter<OutlookMailOptions>(
      outlookMail,
      microsoftOAuthEnvMap,
    ),
    defineFactoryAdapter<MicrosoftTeamsOptions>(
      microsoftTeams,
      microsoftOAuthEnvMap,
    ),
    defineFactoryAdapter<OneDriveOptions>(
      oneDrive,
      microsoftOAuthEnvMap,
    ),
    defineFactoryAdapter<SharePointOptions>(
      sharepoint,
      microsoftOAuthEnvMap,
    ),
    defineFactoryAdapter(() => microsoftExcel365Connector, microsoftOAuthEnvMap),
    defineFactoryAdapter(() => microsoft365PeopleConnector, microsoftOAuthEnvMap),
    defineFactoryAdapter(() => microsoft365PlannerConnector, microsoftOAuthEnvMap),
    defineFactoryAdapter(() => microsoftTodoConnector, microsoftOAuthEnvMap),
    defineFactoryAdapter(() => microsoftOnenoteConnector, microsoftOAuthEnvMap),
    defineFactoryAdapter(() => microsoftPowerBiConnector, microsoftOAuthEnvMap),
    defineFactoryAdapter(() => googleBigqueryConnector, googleOAuthEnvMap),
    defineFactoryAdapter(() => firebaseConnector, {
      clientId: [
        'FIREBASE_OAUTH_CLIENT_ID',
        'GOOGLE_OAUTH_CLIENT_ID',
      ],
      clientSecret: [
        'FIREBASE_OAUTH_CLIENT_SECRET',
        'GOOGLE_OAUTH_CLIENT_SECRET',
      ],
    }),
    defineFactoryAdapter(() => supabaseConnector, {
      clientId: 'SUPABASE_OAUTH_CLIENT_ID',
      clientSecret: 'SUPABASE_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => airtableConnector, {}),
    defineFactoryAdapter(() => baserowConnector, {}),
    defineFactoryAdapter(() => actualbudgetConnector, {}),
    defineFactoryAdapter(() => aianswerConnector, {}),
    defineFactoryAdapter(() => airparserConnector, {}),
    defineFactoryAdapter(() => anyhookWebsocketConnector, {}),
    defineFactoryAdapter(() => apifyConnector, {}),
    defineFactoryAdapter(() => askHandleConnector, {}),
    defineFactoryAdapter(() => bannerbearConnector, {}),
    defineFactoryAdapter(() => base44Connector, {}),
    defineFactoryAdapter(() => beehiivConnector, {}),
    defineFactoryAdapter(() => bikaConnector, {}),
    defineFactoryAdapter(() => buttondownConnector, {}),
    defineFactoryAdapter(() => cambAiConnector, {}),
    defineFactoryAdapter(() => cartloomConnector, {}),
    defineFactoryAdapter(() => chainAwareConnector, {}),
    defineFactoryAdapter(() => chaindeskConnector, {}),
    defineFactoryAdapter(() => chatAidConnector, {}),
    defineFactoryAdapter(() => chatsistantConnector, {}),
    defineFactoryAdapter(() => claudeConnector, {}),
    defineFactoryAdapter(() => clearoutphoneConnector, {}),
    defineFactoryAdapter(() => clickfunnelsConnector, {}),
    defineFactoryAdapter(() => codyConnector, {}),
    defineFactoryAdapter(() => contextualAiConnector, {}),
    defineFactoryAdapter(() => contiguityConnector, {}),
    defineFactoryAdapter(() => couchbaseConnector, {}),
    defineFactoryAdapter(() => dappierConnector, {}),
    defineFactoryAdapter(() => deepgramConnector, {}),
    defineFactoryAdapter(() => detectingAiConnector, {}),
    defineFactoryAdapter(() => digitalPilotConnector, {}),
    defineFactoryAdapter(() => docsbotConnector, {}),
    defineFactoryAdapter(() => dripConnector, {}),
    defineFactoryAdapter(() => echowinConnector, {}),
    defineFactoryAdapter(() => elevenlabsConnector, {}),
    defineFactoryAdapter(() => everhourConnector, {}),
    defineFactoryAdapter(() => featheryConnector, {}),
    defineFactoryAdapter(() => fellowConnector, {}),
    defineFactoryAdapter(() => flowParserConnector, {}),
    defineFactoryAdapter(() => gammaConnector, {}),
    defineFactoryAdapter(() => genderApiConnector, {}),
    defineFactoryAdapter(() => generatebannersConnector, {}),
    defineFactoryAdapter(() => giftbitConnector, {}),
    defineFactoryAdapter(() => modelslabConnector, {}),
    defineFactoryAdapter(() => segmentConnector, {}),
    defineFactoryAdapter(() => hightouchConnector, {}),
    defineFactoryAdapter(() => datadogConnector, {}),
    defineFactoryAdapter(() => discourseConnector, {}),
    defineFactoryAdapter(() => digitalOceanConnector, {}),
    defineFactoryAdapter(() => clicksendConnector, {}),
    defineFactoryAdapter(() => metabaseConnector, {}),
    defineFactoryAdapter(() => mysqlConnector, {}),
    defineFactoryAdapter(
      () => microsoftDynamics365BusinessCentralConnector,
      microsoftOAuthEnvMap,
    ),
    defineFactoryAdapter<WhatsappBusinessOptions>(whatsappBusiness, {
      clientId: 'WHATSAPP_OAUTH_CLIENT_ID',
      clientSecret: 'WHATSAPP_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter<EtsyOptions>(etsyConnector, {
      keystring: 'ETSY_OAUTH_CLIENT_ID',
      clientSecret: 'ETSY_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter<DocuSealOptions>(docuseal, {}),
    defineFactoryAdapter<HelloSignOptions>(hellosign, {
      clientId: 'HELLOSIGN_OAUTH_CLIENT_ID',
      clientSecret: 'HELLOSIGN_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter<PandaDocOptions>(pandadoc, {
      clientId: 'PANDADOC_OAUTH_CLIENT_ID',
      clientSecret: 'PANDADOC_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter<TwitterOptions>(twitter, {
      clientId: 'TWITTER_OAUTH_CLIENT_ID',
      clientSecret: 'TWITTER_OAUTH_CLIENT_SECRET',
    }),
    // Declarative OAuth2 connectors: the manifest already pins clientIdEnv /
    // clientSecretEnv; the envMap re-pins the same names so registration is
    // gated on the OAuth app actually being configured (no half-live connector).
    defineFactoryAdapter(() => quickbooksConnector, {
      clientId: 'QUICKBOOKS_OAUTH_CLIENT_ID',
      clientSecret: 'QUICKBOOKS_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => xeroConnector, {
      clientId: 'XERO_OAUTH_CLIENT_ID',
      clientSecret: 'XERO_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => salesforceConnector, {
      clientId: 'SALESFORCE_OAUTH_CLIENT_ID',
      clientSecret: 'SALESFORCE_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => dropboxConnector, {
      clientId: 'DROPBOX_OAUTH_CLIENT_ID',
      clientSecret: 'DROPBOX_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => boxConnector, {
      clientId: 'BOX_OAUTH_CLIENT_ID',
      clientSecret: 'BOX_OAUTH_CLIENT_SECRET',
    }),
    // File storage and knowledge providers. API-key providers receive their
    // credentials from each connection; OAuth providers are registered only
    // when the shared application credentials are present.
    defineFactoryAdapter(() => amazonEventBridgeConnector, {}),
    defineFactoryAdapter(() => amazonS3Connector, {}),
    defineFactoryAdapter(() => amazonSnsConnector, {}),
    defineFactoryAdapter(() => amazonSqsConnector, {}),
    defineFactoryAdapter(() => httpConnector, {}),
    defineFactoryAdapter(() => rssConnector, {}),
    defineFactoryAdapter(() => kafkaConnector, {}),
    defineFactoryAdapter(() => duckdbConnector, {}),
    defineFactoryAdapter(() => rabbitMqConnector, {}),
    defineFactoryAdapter(() => csvFilesConnector, {}),
    defineFactoryAdapter(() => excelFilesConnector, {}),
    defineFactoryAdapter(() => parquetFilesConnector, {}),
    defineFactoryAdapter(() => sftpConnector, {}),
    defineFactoryAdapter(() => chessComConnector, {}),
    defineFactoryAdapter(() => zapierConnector, {}),
    defineFactoryAdapter(() => makeConnector, {}),
    defineFactoryAdapter(() => n8nConnector, {}),
    defineFactoryAdapter(() => pipedreamConnector, {}),
    defineFactoryAdapter(() => googleCloudStorageConnector, googleOAuthEnvMap),
    defineFactoryAdapter(() => googlePubSubConnector, {}),
    defineFactoryAdapter(() => azureBlobStorageConnector, {}),
    defineFactoryAdapter(() => azureEventGridConnector, {}),
    defineFactoryAdapter(() => azureServiceBusConnector, {}),
    defineFactoryAdapter(() => backblazeConnector, {}),
    defineFactoryAdapter(() => cloudinaryConnector, {}),
    defineFactoryAdapter(() => codaConnector, {}),
    defineFactoryAdapter(() => confluenceConnector, {
      clientId: 'ATLASSIAN_OAUTH_CLIENT_ID',
      clientSecret: 'ATLASSIAN_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => contentfulConnector, {
      clientId: 'CONTENTFUL_OAUTH_CLIENT_ID',
      clientSecret: 'CONTENTFUL_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => zoomConnector, {
      clientId: 'ZOOM_OAUTH_CLIENT_ID',
      clientSecret: 'ZOOM_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => calendlyConnector, {
      clientId: 'CALENDLY_OAUTH_CLIENT_ID',
      clientSecret: 'CALENDLY_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => acuitySchedulingConnector, {
      clientId: 'ACUITY_OAUTH_CLIENT_ID',
      clientSecret: 'ACUITY_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => calComConnector, {
      clientId: 'CALCOM_OAUTH_CLIENT_ID',
      clientSecret: 'CALCOM_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => savvycalConnector, {
      clientId: 'SAVVYCAL_OAUTH_CLIENT_ID',
      clientSecret: 'SAVVYCAL_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => typeformConnector, {
      clientId: 'TYPEFORM_OAUTH_CLIENT_ID',
      clientSecret: 'TYPEFORM_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => jotformConnector, {}),
    defineFactoryAdapter(() => tallyConnector, {}),
    defineFactoryAdapter(() => filloutFormsConnector, {}),
    defineFactoryAdapter(() => webflowConnector, {
      clientId: 'WEBFLOW_OAUTH_CLIENT_ID',
      clientSecret: 'WEBFLOW_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => wordpressConnector, {
      clientId: 'WORDPRESS_OAUTH_CLIENT_ID',
      clientSecret: 'WORDPRESS_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => asanaConnector, {
      clientId: 'ASANA_OAUTH_CLIENT_ID',
      clientSecret: 'ASANA_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => linearConnector, {
      clientId: 'LINEAR_OAUTH_CLIENT_ID',
      clientSecret: 'LINEAR_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => mondayConnector, {
      clientId: 'MONDAY_OAUTH_CLIENT_ID',
      clientSecret: 'MONDAY_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => clickupConnector, {}),
    defineFactoryAdapter(() => basecampConnector, {
      clientId: 'BASECAMP_OAUTH_CLIENT_ID',
      clientSecret: 'BASECAMP_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => todoistConnector, {
      clientId: 'TODOIST_OAUTH_CLIENT_ID',
      clientSecret: 'TODOIST_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => trelloConnector, {}),
    defineFactoryAdapter(() => jiraCloudConnector, {
      clientId: 'ATLASSIAN_OAUTH_CLIENT_ID',
      clientSecret: 'ATLASSIAN_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => ringcentralConnector, {
      clientId: 'RINGCENTRAL_OAUTH_CLIENT_ID',
      clientSecret: 'RINGCENTRAL_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => dialpadConnector, {
      clientId: 'DIALPAD_OAUTH_CLIENT_ID',
      clientSecret: 'DIALPAD_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => aircallConnector, {}),
    defineFactoryAdapter(() => openPhoneConnector, {}),
    defineFactoryAdapter(() => twilioSmsConnector, {}),
    defineFactoryAdapter(() => justcallConnector, {}),
    defineFactoryAdapter(() => granolaConnector, {}),
    defineFactoryAdapter(() => firefliesAiConnector, {}),
    defineFactoryAdapter(() => gongConnector, {
      clientId: 'GONG_OAUTH_CLIENT_ID',
      clientSecret: 'GONG_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => fathomConnector, {
      clientId: 'FATHOM_OAUTH_CLIENT_ID',
      clientSecret: 'FATHOM_OAUTH_CLIENT_SECRET',
    }),
    // Customer-supplied API keys gate these direct adapters at connection
    // time; no shared deployment credential is required.
    defineFactoryAdapter(() => avomaConnector, {}),
    defineFactoryAdapter(() => tlDvConnector, {}),
    defineFactoryAdapter(() => meetgeekAiConnector, {}),
    defineFactoryAdapter(() => recallAiConnector, {}),
    defineFactoryAdapter(() => docusignConnector, {
      clientId: 'DOCUSIGN_OAUTH_CLIENT_ID',
      clientSecret: 'DOCUSIGN_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => adobeSignConnector, {
      clientId: 'ADOBE_SIGN_OAUTH_CLIENT_ID',
      clientSecret: 'ADOBE_SIGN_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => ironcladConnector, {
      clientId: 'IRONCLAD_OAUTH_CLIENT_ID',
      clientSecret: 'IRONCLAD_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => mycaseConnector, {
      clientId: 'MYCASE_OAUTH_CLIENT_ID',
      clientSecret: 'MYCASE_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => signNowConnector, {}),
    defineFactoryAdapter(() => oneSpanSignConnector, {}),
    defineFactoryAdapter(() => affinityConnector, {}),
    defineFactoryAdapter(() => copperConnector, {}),
    defineFactoryAdapter(() => attioConnector, {
      clientId: 'ATTIO_OAUTH_CLIENT_ID',
      clientSecret: 'ATTIO_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => pipedriveConnector, {
      clientId: 'PIPEDRIVE_OAUTH_CLIENT_ID',
      clientSecret: 'PIPEDRIVE_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => closeConnector, {
      clientId: 'CLOSE_OAUTH_CLIENT_ID',
      clientSecret: 'CLOSE_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => zohoCrmConnector, zohoOAuthEnvMap),
    defineFactoryAdapter(() => zohoDeskConnector, zohoOAuthEnvMap),
    defineFactoryAdapter(() => zohoBookingsConnector, zohoOAuthEnvMap),
    defineFactoryAdapter(() => zohoBooksConnector, zohoOAuthEnvMap),
    defineFactoryAdapter(() => zohoInvoiceConnector, zohoOAuthEnvMap),
    defineFactoryAdapter(() => zohoMailConnector, zohoOAuthEnvMap),
    defineFactoryAdapter(() => zohoCampaignsConnector, zohoOAuthEnvMap),
    defineFactoryAdapter(() => microsoftDynamicsCrmConnector, {
      clientId: ['MICROSOFT_DYNAMICS_CRM_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_ID'],
      clientSecret: ['MICROSOFT_DYNAMICS_CRM_OAUTH_CLIENT_SECRET', 'MICROSOFT_OAUTH_CLIENT_SECRET'],
    }),
    defineFactoryAdapter(() => azureAdConnector, {
      clientId: [
        'AZURE_AD_OAUTH_CLIENT_ID',
        'MICROSOFT_OAUTH_CLIENT_ID',
        'MS_OAUTH_CLIENT_ID',
      ],
      clientSecret: [
        'AZURE_AD_OAUTH_CLIENT_SECRET',
        'MICROSOFT_OAUTH_CLIENT_SECRET',
        'MS_OAUTH_CLIENT_SECRET',
      ],
    }),
    defineFactoryAdapter(() => auth0Connector, {
      clientId: 'AUTH0_OAUTH_CLIENT_ID',
      clientSecret: 'AUTH0_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => oktaConnector, {}),
    defineFactoryAdapter(() => pingIdentityConnector, {}),
    defineFactoryAdapter(() => oneloginConnector, {}),
    defineFactoryAdapter(() => scimConnector, {}),
    defineFactoryAdapter(() => twentyConnector, {}),
    defineFactoryAdapter(() => folkConnector, {}),
    defineFactoryAdapter(() => freshsalesConnector, {}),
    defineFactoryAdapter(() => capsuleCrmConnector, {
      clientId: 'CAPSULE_CRM_OAUTH_CLIENT_ID',
      clientSecret: 'CAPSULE_CRM_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => insightlyConnector, {}),
    defineFactoryAdapter(() => biginByZohoConnector, zohoOAuthEnvMap),
    defineFactoryAdapter(() => fireberryConnector, {}),
    defineFactoryAdapter(() => flowluConnector, {}),
    defineFactoryAdapter(() => leadConnectorConnector, {
      clientId: 'LEAD_CONNECTOR_OAUTH_CLIENT_ID',
      clientSecret: 'LEAD_CONNECTOR_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => ninjapipeConnector, {}),
    defineFactoryAdapter(() => instagramBusinessConnector, {
      clientId: [
        'INSTAGRAM_BUSINESS_OAUTH_CLIENT_ID',
        'FACEBOOK_OAUTH_CLIENT_ID',
      ],
      clientSecret: [
        'INSTAGRAM_BUSINESS_OAUTH_CLIENT_SECRET',
        'FACEBOOK_OAUTH_CLIENT_SECRET',
      ],
    }),
    defineFactoryAdapter(() => linkedinConnector, {
      clientId: 'LINKEDIN_OAUTH_CLIENT_ID',
      clientSecret: 'LINKEDIN_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => mastodonConnector, {}),
    defineFactoryAdapter(() => circleConnector, {}),
    defineFactoryAdapter(() => youtubeDataConnector, googleOAuthEnvMap),
    // Revenue/accounting providers use customer-supplied access tokens or
    // credential bundles, so no shared deployment secret gates registration.
    defineFactoryAdapter(() => stripePackConnector, {}),
    defineFactoryAdapter(() => chargebeeConnector, {}),
    defineFactoryAdapter(() => recurlyConnector, {}),
    defineFactoryAdapter(() => avalaraConnector, {}),
    defineFactoryAdapter(() => taxjarConnector, {}),
    defineFactoryAdapter(() => paddleConnector, {}),
    defineFactoryAdapter(() => plaidConnector, {}),
    defineFactoryAdapter(() => rampConnector, {}),
    defineFactoryAdapter(() => brexConnector, {}),
    defineFactoryAdapter(() => billComConnector, {}),
    defineFactoryAdapter(() => netsuiteConnector, {}),
    defineFactoryAdapter(() => sageIntacctConnector, {}),
    defineFactoryAdapter(() => checkoutConnector, {}),
    defineFactoryAdapter(() => mollieConnector, {}),
    defineFactoryAdapter(() => invoiceninjaConnector, {}),
    defineFactoryAdapter(() => baremetricsConnector, {}),
    defineFactoryAdapter(() => squareConnector, {
      clientId: 'SQUARE_OAUTH_CLIENT_ID',
      clientSecret: 'SQUARE_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => shopifyConnector, {
      clientId: 'SHOPIFY_OAUTH_CLIENT_ID',
      clientSecret: 'SHOPIFY_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => lemonSqueezyConnector, {}),
    defineFactoryAdapter(() => shippoConnector, {}),
    defineFactoryAdapter(() => billplzConnector, {}),
    defineFactoryAdapter(() => voucheryIoConnector, {}),
    defineFactoryAdapter(() => saleorConnector, {}),
    defineFactoryAdapter(() => cashfreePaymentsConnector, {}),
    defineFactoryAdapter(() => frontConnector, {
      clientId: 'FRONT_OAUTH_CLIENT_ID',
      clientSecret: 'FRONT_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => zendeskConnector, {
      clientId: 'ZENDESK_OAUTH_CLIENT_ID',
      clientSecret: 'ZENDESK_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => intercomConnector, {
      clientId: 'INTERCOM_OAUTH_CLIENT_ID',
      clientSecret: 'INTERCOM_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => helpscoutConnector, {
      clientId: 'HELPSCOUT_OAUTH_CLIENT_ID',
      clientSecret: 'HELPSCOUT_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => freshdeskConnector, {
      clientId: 'FRESHDESK_OAUTH_CLIENT_ID',
      clientSecret: 'FRESHDESK_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => gorgiasConnector, {
      clientId: 'GORGIAS_OAUTH_CLIENT_ID',
      clientSecret: 'GORGIAS_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => outreachConnector, {
      clientId: 'OUTREACH_OAUTH_CLIENT_ID',
      clientSecret: 'OUTREACH_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => salesloftConnector, {
      clientId: 'SALESLOFT_OAUTH_CLIENT_ID',
      clientSecret: 'SALESLOFT_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => mailchimpConnector, {
      clientId: 'MAILCHIMP_OAUTH_CLIENT_ID',
      clientSecret: 'MAILCHIMP_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => marketoConnector, {
      clientId: 'MARKETO_OAUTH_CLIENT_ID',
      clientSecret: 'MARKETO_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => klaviyoConnector, {
      clientId: 'KLAVIYO_OAUTH_CLIENT_ID',
      clientSecret: 'KLAVIYO_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => apolloConnector, {}),
    defineFactoryAdapter(() => customerIoConnector, {}),
    defineFactoryAdapter(() => brazeConnector, {}),
    defineFactoryAdapter(() => smartleadConnector, {}),
    defineFactoryAdapter(() => lemlistConnector, {}),
    defineFactoryAdapter(() => builtwithConnector, {}),
    defineFactoryAdapter(() => fullenrichConnector, {}),
    defineFactoryAdapter(() => hunterConnector, {}),
    defineFactoryAdapter(() => neverbounceConnector, {}),
    defineFactoryAdapter(() => theirstackConnector, {}),
    defineFactoryAdapter(() => zerobounceConnector, {}),
  ]

export function resolveConnectorAdapterFactoryOptions(
  definition: ConnectorAdapterFactoryDefinition,
  envSource: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> | null {
  const options: Record<string, string> = {}
  for (const [optionName, envNames] of Object.entries(definition.envMap)) {
    const names = Array.isArray(envNames) ? envNames : [envNames]
    const value = names
      .map((name) => envSource[name])
      .find((candidate): candidate is string => Boolean(candidate))
    if (!value) return null
    options[optionName] = value
  }
  return options
}
