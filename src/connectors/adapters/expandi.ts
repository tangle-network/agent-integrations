import { declarativeRestConnector } from './declarative-rest.js'

// Expandi — LinkedIn outreach automation. Add contacts to campaign instances and trigger LinkedIn actions (connection requests, messages) on connected accounts.
// Auth: api-key. Base: https://api.liaufa.com/api/v1/open-api/v2. Docs: https://api.liaufa.com/open-swagger/
export const expandiConnector = declarativeRestConnector({
  kind: 'expandi',
  displayName: 'Expandi',
  description: 'LinkedIn outreach automation. Add contacts to campaign instances and trigger LinkedIn actions (connection requests, messages) on connected accounts.',
  auth: {
    kind: 'api-key',
    hint: 'From Account Settings, copy both the API key and secret. Every request needs the key (sent as the \'key\' header) AND the secret (pass it as the \'secret\' argument on each call, sent as the \'secret\' header).',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.liaufa.com/api/v1/open-api/v2',
  credentialPlacement: { kind: 'header', header: 'key' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/workspaces/', headers: { secret: '{secret}' } },
  capabilities: [
    {
      name: 'li_accounts.list',
      class: 'read',
      description: 'List the connected LinkedIn accounts in a workspace.',
      parameters: {
        type: 'object',
        properties: {
          secret: {
            type: 'string',
            description: 'Expandi API secret (sent as the \'secret\' header).',
          },
          workspace_id: { type: 'string', description: 'Workspace ID filter.' },
          page: { type: 'string', description: 'Page cursor.' },
        },
        required: ['secret'],
      },
      request: {
        method: 'GET',
        path: '/li_accounts/',
        headers: { secret: '{secret}' },
        query: { workspace_id: '{workspace_id}', page: '{page}' },
      },
    },
    {
      name: 'campaign_instances.list',
      class: 'read',
      description: 'List campaign instances for a given LinkedIn account.',
      parameters: {
        type: 'object',
        properties: {
          secret: {
            type: 'string',
            description: 'Expandi API secret (sent as the \'secret\' header).',
          },
          id: { type: 'string', description: 'LinkedIn account ID.' },
          type: { type: 'string', description: 'Campaign type filter.' },
          active: { type: 'integer', description: 'Filter by active state (1/0).' },
          page: { type: 'string', description: 'Page cursor.' },
        },
        required: ['secret', 'id'],
      },
      request: {
        method: 'GET',
        path: '/li_accounts/{id}/campaign_instances/',
        headers: { secret: '{secret}' },
        query: { type: '{type}', active: '{active}', page: '{page}' },
      },
    },
    {
      name: 'campaign_instance.create_contact',
      class: 'mutation',
      description: 'Add a LinkedIn profile as a contact into a specific campaign instance.',
      parameters: {
        type: 'object',
        properties: {
          secret: {
            type: 'string',
            description: 'Expandi API secret (sent as the \'secret\' header).',
          },
          id: { type: 'string', description: 'Campaign instance ID.' },
          profile_link: { type: 'string', description: 'LinkedIn profile URL of the contact.' },
          placeholders: { type: 'object', description: 'Key-value personalization placeholders.' },
        },
        required: ['secret', 'id', 'profile_link'],
      },
      request: {
        method: 'POST',
        path: '/li_accounts/campaign_instances/{id}/create_contact/',
        headers: { secret: '{secret}' },
        body: { profile_link: '{profile_link}', placeholders: '{placeholders}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'li_account.connection_request',
      class: 'mutation',
      description: 'Send a LinkedIn connection request from a connected account to a profile.',
      parameters: {
        type: 'object',
        properties: {
          secret: {
            type: 'string',
            description: 'Expandi API secret (sent as the \'secret\' header).',
          },
          id: { type: 'string', description: 'LinkedIn account ID.' },
          profile_link: { type: 'string', description: 'Target LinkedIn profile URL.' },
          note: { type: 'string', description: 'Optional connection note.' },
          ignore_campaigns: { type: 'boolean', description: 'Run outside of campaign limits.' },
        },
        required: ['secret', 'id', 'profile_link'],
      },
      request: {
        method: 'POST',
        path: '/li_accounts/{id}/actions/connection_request/',
        headers: { secret: '{secret}' },
        body: {
          profile_link: '{profile_link}',
          note: '{note}',
          ignore_campaigns: '{ignore_campaigns}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'li_account.message',
      class: 'mutation',
      description: 'Send a LinkedIn direct message from a connected account to a profile.',
      parameters: {
        type: 'object',
        properties: {
          secret: {
            type: 'string',
            description: 'Expandi API secret (sent as the \'secret\' header).',
          },
          id: { type: 'string', description: 'LinkedIn account ID.' },
          profile_link: { type: 'string', description: 'Target LinkedIn profile URL.' },
          message: { type: 'string', description: 'Message text.' },
          ignore_campaigns: { type: 'boolean', description: 'Run outside of campaign limits.' },
        },
        required: ['secret', 'id', 'profile_link', 'message'],
      },
      request: {
        method: 'POST',
        path: '/li_accounts/{id}/actions/message/',
        headers: { secret: '{secret}' },
        body: {
          profile_link: '{profile_link}',
          message: '{message}',
          ignore_campaigns: '{ignore_campaigns}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
