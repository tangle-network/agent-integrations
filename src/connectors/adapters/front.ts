import { declarativeRestConnector } from './declarative-rest.js'

export const frontConnector = declarativeRestConnector({
  kind: 'front',
  displayName: 'Front',
  description: 'Search Front shared-inbox conversations, reply on behalf of a teammate, and triage contacts.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.frontapp.com/oauth/authorize',
    tokenUrl: 'https://app.frontapp.com/oauth/token',
    scopes: ['shared_resources', 'private_resources'],
    clientIdEnv: 'FRONT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FRONT_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api2.frontapp.com',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'conversations.search',
      class: 'read',
      description: 'Search conversations in shared inboxes using Front query syntax.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Front search query, e.g. "is:open tag:billing".' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          page_token: { type: 'string' },
        },
        required: ['q'],
      },
      request: {
        method: 'GET',
        path: '/conversations/search/{q}',
        query: { limit: '{limit}', page_token: '{page_token}' },
      },
      requiredScopes: ['shared_resources'],
    },
    {
      name: 'conversations.get',
      class: 'read',
      description: 'Read a single conversation including its current assignee, status, and tags.',
      parameters: {
        type: 'object',
        properties: { conversation_id: { type: 'string' } },
        required: ['conversation_id'],
      },
      request: { method: 'GET', path: '/conversations/{conversation_id}' },
      requiredScopes: ['shared_resources'],
    },
    {
      name: 'conversations.list_messages',
      class: 'read',
      description: 'List messages on a conversation in chronological order.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          page_token: { type: 'string' },
        },
        required: ['conversation_id'],
      },
      request: {
        method: 'GET',
        path: '/conversations/{conversation_id}/messages',
        query: { limit: '{limit}', page_token: '{page_token}' },
      },
      requiredScopes: ['shared_resources'],
    },
    {
      name: 'conversations.reply',
      class: 'mutation',
      description: 'Reply to a conversation by sending an outbound message on the conversation thread.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string' },
          author_id: { type: 'string', description: 'Front teammate id sending the reply.' },
          body: { type: 'string' },
          text: { type: 'string' },
          subject: { type: 'string' },
          to: { type: 'array', items: { type: 'string' } },
          cc: { type: 'array', items: { type: 'string' } },
          bcc: { type: 'array', items: { type: 'string' } },
          options: { type: 'object' },
        },
        required: ['conversation_id', 'body'],
      },
      request: {
        method: 'POST',
        path: '/conversations/{conversation_id}/messages',
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['shared_resources'],
    },
    {
      name: 'conversations.add_comment',
      class: 'mutation',
      description: 'Add an internal comment to a conversation. Comments are visible to teammates only.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string' },
          author_id: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['conversation_id', 'author_id', 'body'],
      },
      request: {
        method: 'POST',
        path: '/conversations/{conversation_id}/comments',
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['shared_resources'],
    },
    {
      name: 'conversations.update',
      class: 'mutation',
      description: 'Update a conversation. Reassign, archive, restore, set status, or add tags.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string' },
          assignee_id: { type: 'string', description: 'Teammate id; pass null to unassign.' },
          status: { type: 'string', enum: ['archived', 'open', 'deleted', 'spam'] },
          inbox_id: { type: 'string' },
          tag_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['conversation_id'],
      },
      request: {
        method: 'PATCH',
        path: '/conversations/{conversation_id}',
        body: 'args',
      },
      cas: 'etag-if-match',
      requiredScopes: ['shared_resources'],
    },
    {
      name: 'contacts.search',
      class: 'read',
      description: 'List contacts in the Front account.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          page_token: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: { q: '{q}', limit: '{limit}', page_token: '{page_token}' },
      },
      requiredScopes: ['shared_resources'],
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a Front contact with handles, name, and metadata.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          handles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                handle: { type: 'string' },
                source: { type: 'string', enum: ['email', 'phone', 'twitter', 'facebook', 'intercom', 'front_chat', 'custom'] },
              },
              required: ['handle', 'source'],
            },
          },
          links: { type: 'array', items: { type: 'string' } },
          group_names: { type: 'array', items: { type: 'string' } },
          custom_fields: { type: 'object' },
        },
        required: ['handles'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['shared_resources'],
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update a Front contact.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          custom_fields: { type: 'object' },
        },
        required: ['contact_id'],
      },
      request: {
        method: 'PATCH',
        path: '/contacts/{contact_id}',
        body: 'args',
      },
      cas: 'etag-if-match',
      requiredScopes: ['shared_resources'],
    },
  ],
})
