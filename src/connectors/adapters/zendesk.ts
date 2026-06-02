import { declarativeRestConnector } from './declarative-rest.js'

// Zendesk OAuth and REST endpoints are scoped to a per-account subdomain
// (https://{subdomain}.zendesk.com). The OAuth orchestrator substitutes
// `{subdomain}` from connection metadata before building the authorize
// redirect; the executor reads the same metadata key to resolve baseUrl.
// Captured as a {subdomain} token in the static URLs below (matches the
// same per-tenant-host pattern Salesforce uses via metadata.instanceUrl).

export const zendeskConnector = declarativeRestConnector({
  kind: 'zendesk',
  displayName: 'Zendesk',
  description: 'Search, read, create, and update Zendesk support tickets and end users.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://{subdomain}.zendesk.com/oauth/authorizations/new',
    tokenUrl: 'https://{subdomain}.zendesk.com/oauth/tokens',
    scopes: ['read', 'write'],
    clientIdEnv: 'ZENDESK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ZENDESK_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'subdomainUrl' },
  test: { method: 'GET', path: '/api/v2/users/me.json' },
  capabilities: [
    {
      name: 'tickets.search',
      class: 'read',
      description: 'Search tickets using the Zendesk search query syntax (e.g. status:open priority:high).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          sort_by: { type: 'string' },
          sort_order: { type: 'string', enum: ['asc', 'desc'] },
          per_page: { type: 'integer' },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/search.json',
        query: {
          query: '{query}',
          sort_by: '{sort_by}',
          sort_order: '{sort_order}',
          per_page: '{per_page}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'tickets.get',
      class: 'read',
      description: 'Read a single Zendesk ticket by id.',
      parameters: {
        type: 'object',
        properties: { ticketId: { type: 'string' } },
        required: ['ticketId'],
      },
      request: { method: 'GET', path: '/api/v2/tickets/{ticketId}.json' },
      requiredScopes: ['read'],
    },
    {
      name: 'tickets.create',
      class: 'mutation',
      description: 'Create a Zendesk ticket. Pass the Zendesk ticket payload under `ticket`.',
      parameters: {
        type: 'object',
        properties: { ticket: { type: 'object' } },
        required: ['ticket'],
      },
      request: { method: 'POST', path: '/api/v2/tickets.json', body: { ticket: '{ticket}' } },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'tickets.update',
      class: 'mutation',
      description: 'Update a Zendesk ticket. Pass the Zendesk ticket payload under `ticket`.',
      parameters: {
        type: 'object',
        properties: { ticketId: { type: 'string' }, ticket: { type: 'object' } },
        required: ['ticketId', 'ticket'],
      },
      request: {
        method: 'PUT',
        path: '/api/v2/tickets/{ticketId}.json',
        body: { ticket: '{ticket}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write'],
    },
    {
      name: 'users.search',
      class: 'read',
      description: 'Search end users (the Zendesk requesters/customers).',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, per_page: { type: 'integer' } },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/users/search.json',
        query: { query: '{query}', per_page: '{per_page}' },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'users.create',
      class: 'mutation',
      description: 'Create a Zendesk end user. Pass the Zendesk user payload under `user`.',
      parameters: {
        type: 'object',
        properties: { user: { type: 'object' } },
        required: ['user'],
      },
      request: { method: 'POST', path: '/api/v2/users.json', body: { user: '{user}' } },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'tickets.delete',
      class: 'mutation',
      description: 'Delete a Zendesk ticket by id. Soft-deletes per Zendesk retention rules.',
      parameters: {
        type: 'object',
        properties: { ticketId: { type: 'string' } },
        required: ['ticketId'],
      },
      request: { method: 'DELETE', path: '/api/v2/tickets/{ticketId}.json' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write'],
    },
    {
      name: 'tickets.merge',
      class: 'mutation',
      description:
        'Merge one or more source tickets into a target ticket. `ids` lists the source tickets to merge into `ticketId`. Pass optional comments under `target_comment` / `source_comment`.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          ids: { type: 'array', items: { type: 'string' } },
          target_comment: { type: 'string' },
          source_comment: { type: 'string' },
        },
        required: ['ticketId', 'ids'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/tickets/{ticketId}/merge.json',
        body: { ids: '{ids}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write'],
    },
    {
      name: 'tickets.add-comment',
      class: 'mutation',
      description:
        'Add a public or internal comment to an existing ticket. Set `public` to false for an internal note.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          body: { type: 'string' },
          public: { type: 'boolean' },
        },
        required: ['ticketId', 'body', 'public'],
      },
      request: {
        method: 'PUT',
        path: '/api/v2/tickets/{ticketId}.json',
        body: {
          ticket: {
            comment: {
              body: '{body}',
              public: '{public}',
            },
          },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write'],
    },
    {
      name: 'users.update',
      class: 'mutation',
      description: 'Update a Zendesk end user. Pass the Zendesk user payload under `user`.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' }, user: { type: 'object' } },
        required: ['userId', 'user'],
      },
      request: {
        method: 'PUT',
        path: '/api/v2/users/{userId}.json',
        body: { user: '{user}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write'],
    },
    {
      name: 'users.delete',
      class: 'mutation',
      description: 'Delete a Zendesk end user by id. Soft-deletes per Zendesk retention rules.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      request: { method: 'DELETE', path: '/api/v2/users/{userId}.json' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write'],
    },
  ],
})
