import { declarativeRestConnector } from './declarative-rest.js'

// GetResponse — Email marketing platform for managing contacts, lists (campaigns), and sending newsletters.
// Auth: api-key. Base: https://api.getresponse.com/v3. Docs: https://apidocs.getresponse.com/v3
export const getresponseConnector = declarativeRestConnector({
  kind: 'getresponse',
  displayName: 'GetResponse',
  description: 'Email marketing platform for managing contacts, lists (campaigns), and sending newsletters.',
  auth: {
    kind: 'api-key',
    hint: 'Generate an API key at app.getresponse.com/api. Sent as the X-Auth-Token header with the \'api-key \' prefix (X-Auth-Token: api-key <KEY>).',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.getresponse.com/v3',
  credentialPlacement: { kind: 'header', header: 'X-Auth-Token', prefix: 'api-key ' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/accounts' },
  capabilities: [
    {
      name: 'contacts.list',
      class: 'read',
      description: 'List or search contacts, optionally filtered by email or campaign (list).',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          campaignId: { type: 'string' },
          page: { type: 'integer' },
          perPage: { type: 'integer' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: {
          'query[email]': '{email}',
          'query[campaignId]': '{campaignId}',
          page: '{page}',
          perPage: '{perPage}',
        },
      },
    },
    {
      name: 'campaigns.list',
      class: 'read',
      description: 'List campaigns (contact lists). The campaignId returned here is used when adding contacts or sending newsletters.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          page: { type: 'integer' },
          perPage: { type: 'integer' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/campaigns',
        query: { 'query[name]': '{name}', page: '{page}', perPage: '{perPage}' },
      },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Add (import) a contact to a campaign (list). Only email and campaign id are required.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          campaign_id: { type: 'string' },
          name: { type: 'string' },
          dayOfCycle: { type: 'integer' },
        },
        required: ['email', 'campaign_id'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          email: '{email}',
          name: '{name}',
          dayOfCycle: '{dayOfCycle}',
          campaign: { campaignId: '{campaign_id}' },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'newsletters.create',
      class: 'mutation',
      description: 'Create and send a newsletter (broadcast email) to a campaign. Requires subject, fromFieldId, HTML content, and a target campaign.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          fromFieldId: { type: 'string' },
          html: { type: 'string' },
          campaign_id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['subject', 'fromFieldId', 'html', 'campaign_id'],
      },
      request: {
        method: 'POST',
        path: '/newsletters',
        body: {
          name: '{name}',
          subject: '{subject}',
          fromField: { fromFieldId: '{fromFieldId}' },
          content: { html: '{html}' },
          campaign: { campaignId: '{campaign_id}' },
          sendSettings: { selectedCampaigns: ['{campaign_id}'] },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
