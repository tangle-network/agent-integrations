import { declarativeRestConnector } from './declarative-rest.js'

/**
 * SendPulse adapter — REST API at https://api.sendpulse.com/
 *
 * Auth: OAuth2 client credentials (clientId + clientSecret) exchanged for
 * an access token. The token is forwarded as a Bearer token in the
 * Authorization header on every call.
 *
 * Capabilities mirror the activepieces catalog entry for `sendpulse`:
 * subscriber lifecycle (add, update, delete, unsubscribe), and variable
 * management per subscriber.
 */
export const sendpulseConnector = declarativeRestConnector({
  kind: 'sendpulse',
  displayName: 'SendPulse',
  description:
    'Manage SendPulse subscribers, contacts, and subscriber variables through the REST API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.sendpulse.com/oauth/authorize',
    tokenUrl: 'https://api.sendpulse.com/oauth/access_token',
    scopes: [],
    clientIdEnv: 'SENDPULSE_CLIENT_ID',
    clientSecretEnv: 'SENDPULSE_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.sendpulse.com',
  test: { method: 'GET', path: '/api/v1/user' },
  capabilities: [
    {
      name: 'subscriber.add',
      class: 'mutation',
      description: 'Add a new subscriber to an addressbook.',
      parameters: {
        type: 'object',
        properties: {
          addressbookId: { type: 'string' },
          email: { type: 'string' },
          variables: { type: 'object' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['addressbookId', 'email'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/addressbooks/{addressbookId}/subscribers',
        body: {
          email: '{email}',
          variables: '{variables}',
          tags: '{tags}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscriber.update',
      class: 'mutation',
      description: 'Update an existing subscriber in an addressbook.',
      parameters: {
        type: 'object',
        properties: {
          addressbookId: { type: 'string' },
          email: { type: 'string' },
          variables: { type: 'object' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['addressbookId', 'email'],
      },
      request: {
        method: 'PUT',
        path: '/api/v1/addressbooks/{addressbookId}/subscribers',
        body: {
          email: '{email}',
          variables: '{variables}',
          tags: '{tags}',
        },
      },
      cas: 'etag-if-match',
    },
    {
      name: 'subscriber.delete',
      class: 'mutation',
      description: 'Delete a contact from an addressbook permanently.',
      parameters: {
        type: 'object',
        properties: {
          addressbookId: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['addressbookId', 'email'],
      },
      request: {
        method: 'DELETE',
        path: '/api/v1/addressbooks/{addressbookId}/subscribers',
        query: { email: '{email}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'subscriber.unsubscribe',
      class: 'mutation',
      description: 'Unsubscribe one or more email addresses from an addressbook.',
      parameters: {
        type: 'object',
        properties: {
          addressbookId: { type: 'string' },
          emails: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 100,
          },
        },
        required: ['addressbookId', 'emails'],
      },
      request: {
        method: 'PUT',
        path: '/api/v1/addressbooks/{addressbookId}/unsubscribe',
        body: { emails: '{emails}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'subscriber.variable.update',
      class: 'mutation',
      description: 'Update a variable for a specific subscriber.',
      parameters: {
        type: 'object',
        properties: {
          addressbookId: { type: 'string' },
          email: { type: 'string' },
          variableName: { type: 'string' },
          variableValue: { type: 'string' },
        },
        required: ['addressbookId', 'email', 'variableName', 'variableValue'],
      },
      request: {
        method: 'PUT',
        path: '/api/v1/addressbooks/{addressbookId}/subscribers/updateVariable',
        body: {
          email: '{email}',
          variable: {
            name: '{variableName}',
            value: '{variableValue}',
          },
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'addressbooks.list',
      class: 'read',
      description: 'List all addressbooks on the account.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/addressbooks',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'subscriber.get',
      class: 'read',
      description: 'Retrieve a single subscriber from an addressbook by email.',
      parameters: {
        type: 'object',
        properties: {
          addressbookId: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['addressbookId', 'email'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/addressbooks/{addressbookId}/subscribers',
        query: { email: '{email}' },
      },
    },
    {
      name: 'addressbooks.create',
      class: 'mutation',
      description: 'Create a new addressbook (contact list).',
      parameters: {
        type: 'object',
        properties: {
          bookName: {
            type: 'string',
            description: 'Display name for the new addressbook.',
          },
        },
        required: ['bookName'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/addressbooks',
        body: { bookName: '{bookName}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'addressbooks.delete',
      class: 'mutation',
      description: 'Delete an addressbook by ID.',
      parameters: {
        type: 'object',
        properties: {
          addressbookId: {
            type: 'string',
            description: 'ID of the addressbook to delete.',
          },
        },
        required: ['addressbookId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/v1/addressbooks/{addressbookId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'campaigns.create',
      class: 'mutation',
      description: 'Create a new email campaign (sent immediately or scheduled via send_date).',
      parameters: {
        type: 'object',
        properties: {
          sender_name: { type: 'string' },
          sender_email: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string', description: 'Base64-encoded HTML body of the campaign.' },
          list_id: { type: 'string', description: 'ID of the addressbook to send to.' },
          name: { type: 'string' },
          template_id: { type: 'string' },
          type: { type: 'string', description: 'Optional campaign type (e.g., "regular").' },
          send_date: {
            type: 'string',
            description: 'Optional scheduled send date in YYYY-MM-DD HH:mm:ss format.',
          },
          attachments: { type: 'object' },
        },
        required: ['sender_name', 'sender_email', 'subject', 'body', 'list_id'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/campaigns',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'campaigns.cancel',
      class: 'mutation',
      description: 'Cancel a scheduled campaign before it is sent.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: {
            type: 'string',
            description: 'ID of the scheduled campaign to cancel.',
          },
        },
        required: ['campaignId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/v1/campaigns/{campaignId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
