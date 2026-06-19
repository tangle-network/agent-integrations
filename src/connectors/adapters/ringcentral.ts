import { declarativeRestConnector } from './declarative-rest.js'

/**
 * RingCentral cloud-communications API — REST v1.0.
 *
 * Standard 3-legged OAuth2 authorization_code flow (authorize at
 * platform.ringcentral.com/restapi/oauth/authorize, token at
 * platform.ringcentral.com/restapi/oauth/token). RingCentral "application
 * permissions" (scopes) are fixed when the OAuth app is registered in the
 * Developer Console and the authorize endpoint ignores a per-request
 * `scope` param — we still list the permissions the capabilities here rely
 * on for operator visibility.
 *
 * Paths use the literal `~` segment, RingCentral's alias for "the
 * authenticated account / extension", so most calls need no ids. The
 * declarative runtime passes `~` through untouched (it only interpolates
 * `{placeholders}`).
 */
export const ringcentralConnector = declarativeRestConnector({
  kind: 'ringcentral',
  displayName: 'RingCentral',
  description:
    'Read RingCentral extensions, call logs, and messages, send SMS, and create webhook subscriptions through the REST v1.0 API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://platform.ringcentral.com/restapi/oauth/authorize',
    tokenUrl: 'https://platform.ringcentral.com/restapi/oauth/token',
    scopes: ['ReadAccounts', 'ReadCallLog', 'ReadMessages', 'SMS', 'ReadContacts', 'SubscriptionWebhook'],
    clientIdEnv: 'RINGCENTRAL_OAUTH_CLIENT_ID',
    clientSecretEnv: 'RINGCENTRAL_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://platform.ringcentral.com/restapi/v1.0',
  test: { method: 'GET', path: '/account/~/extension/~' },
  capabilities: [
    {
      name: 'extension.get',
      class: 'read',
      description: "Get the authenticated user's extension record.",
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/account/~/extension/~' },
    },
    {
      name: 'extensions.list',
      class: 'read',
      description: 'List extensions on an account. Pass accountId or ~ for the authenticated account.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Internal account id, or ~ for the authenticated account.' },
          page: { type: 'number', description: 'Page number for pagination.' },
          perPage: { type: 'number', description: 'Records per page.' },
          status: { type: 'string', description: 'Filter by extension status (e.g. Enabled, Disabled).' },
        },
        required: ['accountId'],
      },
      request: {
        method: 'GET',
        path: '/account/{accountId}/extension',
        query: { page: '{page}', perPage: '{perPage}', status: '{status}' },
      },
    },
    {
      name: 'callLog.list',
      class: 'read',
      description: "List the authenticated extension's call log. Use view=Detailed for full records.",
      parameters: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string', description: 'Start of range, ISO-8601 UTC.' },
          dateTo: { type: 'string', description: 'End of range, ISO-8601 UTC.' },
          view: { type: 'string', description: "Set to 'Detailed' to fetch detailed call records." },
          perPage: { type: 'number', description: 'Records per page.' },
        },
      },
      request: {
        method: 'GET',
        path: '/account/~/extension/~/call-log',
        query: { dateFrom: '{dateFrom}', dateTo: '{dateTo}', view: '{view}', perPage: '{perPage}' },
      },
    },
    {
      name: 'messages.list',
      class: 'read',
      description: "List the authenticated extension's message store (SMS, Fax, VoiceMail).",
      parameters: {
        type: 'object',
        properties: {
          messageType: { type: 'string', description: 'Filter by message type: SMS, Fax, or VoiceMail.' },
          dateFrom: { type: 'string', description: 'Start of range, ISO-8601.' },
          dateTo: { type: 'string', description: 'End of range, ISO-8601.' },
          perPage: { type: 'number', description: 'Records per page (up to 1000).' },
          readStatus: { type: 'string', description: 'Filter by read status: Read or Unread.' },
        },
      },
      request: {
        method: 'GET',
        path: '/account/~/extension/~/message-store',
        query: {
          messageType: '{messageType}',
          dateFrom: '{dateFrom}',
          dateTo: '{dateTo}',
          perPage: '{perPage}',
          readStatus: '{readStatus}',
        },
      },
    },
    {
      name: 'sms.send',
      class: 'mutation',
      description:
        'Send an SMS from the authenticated extension. from = { phoneNumber }, to = [{ phoneNumber }] (up to 10), text = body.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'object', description: 'Sender: { phoneNumber } — must be a number assigned to the user.', additionalProperties: true },
          to: {
            type: 'array',
            description: 'Recipients: [{ phoneNumber }] — up to 10.',
            items: { type: 'object', additionalProperties: true },
          },
          text: { type: 'string', description: 'SMS message text.' },
        },
        required: ['from', 'to', 'text'],
      },
      request: { method: 'POST', path: '/account/~/extension/~/sms', body: { from: '{from}', to: '{to}', text: '{text}' } },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscriptions.create',
      class: 'mutation',
      description:
        'Create a webhook subscription. eventFilters = array of event URIs, deliveryMode = { transportType: "WebHook", address }.',
      parameters: {
        type: 'object',
        properties: {
          eventFilters: {
            type: 'array',
            description: 'Event filter URI strings, e.g. /restapi/v1.0/account/~/extension/~/message-store.',
            items: { type: 'string' },
          },
          deliveryMode: {
            type: 'object',
            description: 'Delivery config: { transportType: "WebHook", address }.',
            additionalProperties: true,
          },
          expiresIn: { type: 'number', description: 'Subscription lifetime in seconds.' },
        },
        required: ['eventFilters', 'deliveryMode'],
      },
      request: {
        method: 'POST',
        path: '/subscription',
        body: { eventFilters: '{eventFilters}', deliveryMode: '{deliveryMode}', expiresIn: '{expiresIn}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
