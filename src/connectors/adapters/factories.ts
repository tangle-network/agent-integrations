import type { ConnectorAdapter } from '../types.js'
import { adobeSignConnector } from './adobe-sign.js'
import { aircallConnector } from './aircall.js'
import { asanaConnector } from './asana.js'
import { boxConnector } from './box.js'
import { calendlyConnector } from './calendly.js'
import { docuseal, type DocuSealOptions } from './docuseal.js'
import { docusignConnector } from './docusign.js'
import { dialpadConnector } from './dialpad.js'
import { dropboxConnector } from './dropbox.js'
import { etsyConnector, type EtsyOptions } from './etsy.js'
import { fathomConnector } from './fathom.js'
import { firefliesAiConnector } from './fireflies-ai.js'
import { gmail, type GmailOptions } from './gmail.js'
import { gongConnector } from './gong.js'
import {
  googleCalendar,
  type GoogleCalendarOptions,
} from './google-calendar.js'
import { googleDocs, type GoogleDocsOptions } from './google-docs.js'
import { googleDrive, type GoogleDriveOptions } from './google-drive.js'
import { googleForms, type GoogleFormsOptions } from './google-forms.js'
import { googleSheets, type GoogleSheetsOptions } from './google-sheets.js'
import { granolaConnector } from './granola.js'
import { hellosign, type HelloSignOptions } from './hellosign.js'
import { hubspot, type HubSpotOptions } from './hubspot.js'
import { ironcladConnector } from './ironclad.js'
import {
  microsoftCalendar,
  type MicrosoftCalendarOptions,
} from './microsoft-calendar.js'
import {
  microsoftGraph,
  type MicrosoftGraphOptions,
} from './microsoft-graph.js'
import {
  microsoftTeams,
  type MicrosoftTeamsOptions,
} from './microsoft-teams.js'
import { notion, type NotionOptions } from './notion.js'
import { openPhoneConnector } from './open-phone.js'
import { oneDrive, type OneDriveOptions } from './onedrive.js'
import { oneSpanSignConnector } from './onespan-sign.js'
import { outlookMail, type OutlookMailOptions } from './outlook-mail.js'
import { pandadoc, type PandaDocOptions } from './pandadoc.js'
import { quickbooksConnector } from './quickbooks.js'
import { ringcentralConnector } from './ringcentral.js'
import { salesforceConnector } from './salesforce.js'
import { sharepoint, type SharePointOptions } from './sharepoint.js'
import { signNowConnector } from './sign-now.js'
import { slack, type SlackOptions } from './slack.js'
import { twitter, type TwitterOptions } from './twitter.js'
import { twilioSmsConnector } from './twilio-sms.js'
import {
  whatsappBusiness,
  type WhatsappBusinessOptions,
} from './whatsapp-business.js'
import { xeroConnector } from './xero.js'
import { zoomConnector } from './zoom.js'

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
    defineFactoryAdapter<SlackOptions>(slack, {
      clientId: 'SLACK_OAUTH_CLIENT_ID',
      clientSecret: 'SLACK_OAUTH_CLIENT_SECRET',
    }),
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
    defineFactoryAdapter(() => zoomConnector, {
      clientId: 'ZOOM_OAUTH_CLIENT_ID',
      clientSecret: 'ZOOM_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => calendlyConnector, {
      clientId: 'CALENDLY_OAUTH_CLIENT_ID',
      clientSecret: 'CALENDLY_OAUTH_CLIENT_SECRET',
    }),
    defineFactoryAdapter(() => asanaConnector, {
      clientId: 'ASANA_OAUTH_CLIENT_ID',
      clientSecret: 'ASANA_OAUTH_CLIENT_SECRET',
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
    defineFactoryAdapter(() => signNowConnector, {}),
    defineFactoryAdapter(() => oneSpanSignConnector, {}),
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
