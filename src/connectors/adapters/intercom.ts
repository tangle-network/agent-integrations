import { declarativeRestConnector } from './declarative-rest.js'

export const intercomConnector = declarativeRestConnector({
  kind: 'intercom',
  displayName: 'Intercom',
  description: 'Search Intercom conversations and contacts, reply to support tickets, and update conversation state.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.intercom.com/oauth',
    tokenUrl: 'https://api.intercom.io/auth/eagle/token',
    scopes: [],
    clientIdEnv: 'INTERCOM_OAUTH_CLIENT_ID',
    clientSecretEnv: 'INTERCOM_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.intercom.io',
  defaultHeaders: {
    'intercom-version': '2.11',
  },
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'tickets.search',
      class: 'read',
      description: 'Search Intercom conversations using Intercom search syntax. Pass `body` as `{ query, pagination? }` per Intercom REST docs.',
      parameters: {
        type: 'object',
        properties: {
          body: {
            type: 'object',
            description: 'Intercom search payload: { query: { field, operator, value } | { operator, value: [...] }, pagination?: { per_page, starting_after } }.',
          },
        },
        required: ['body'],
      },
      request: {
        method: 'POST',
        path: '/conversations/search',
        body: '{body}',
      },
      requiredScopes: ['intercom.read'],
    },
    {
      name: 'customers.read',
      class: 'read',
      description: 'Read an Intercom contact (lead or user) by id.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' } },
        required: ['contactId'],
      },
      request: { method: 'GET', path: '/contacts/{contactId}' },
      requiredScopes: ['intercom.read'],
    },
    {
      name: 'tickets.reply',
      class: 'mutation',
      description: 'Reply to an Intercom conversation. Pass the full reply payload as `body` (must include message_type, type, and body text per Intercom REST docs).',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
          body: {
            type: 'object',
            description: 'Intercom reply payload: { message_type, type, admin_id?, body, attachment_urls? }.',
          },
        },
        required: ['conversationId', 'body'],
      },
      request: {
        method: 'POST',
        path: '/conversations/{conversationId}/reply',
        body: '{body}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['intercom.write'],
    },
    {
      name: 'tickets.update',
      class: 'mutation',
      description: 'Update an Intercom conversation (mark read, change state, set custom attributes).',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
          body: {
            type: 'object',
            description: 'Intercom conversation update payload: { read?, state?, custom_attributes? }.',
          },
        },
        required: ['conversationId', 'body'],
      },
      request: {
        method: 'PUT',
        path: '/conversations/{conversationId}',
        body: '{body}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['intercom.write'],
    },
  ],
})
