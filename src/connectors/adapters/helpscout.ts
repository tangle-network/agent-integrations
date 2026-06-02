import { declarativeRestConnector } from './declarative-rest.js'

// Help Scout Mailbox API v2.
// OAuth2 docs: https://developer.helpscout.com/mailbox-api/overview/authentication/
// The authorize endpoint does not accept a `scope` parameter; access is governed
// by the connecting user's role on each mailbox. We still declare logical scopes
// here so capability-level enforcement at the hub matches the rest of the
// declarative-rest family (records.search.read, tickets.reply.write, etc.) and
// the hub can deny actions a caller wasn't granted at consent time.

const conversationParams = {
  type: 'object',
  properties: { conversationId: { type: 'string' } },
  required: ['conversationId'],
}

export const helpscoutConnector = declarativeRestConnector({
  kind: 'helpscout',
  displayName: 'Help Scout',
  description: 'Search and update Help Scout conversations, reply to support tickets, and read customer profiles.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://secure.helpscout.net/authentication/authorizeClientApplication',
    tokenUrl: 'https://api.helpscout.net/v2/oauth2/token',
    scopes: ['tickets.search.read', 'tickets.reply.write', 'customers.read'],
    clientIdEnv: 'HELPSCOUT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'HELPSCOUT_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.helpscout.net',
  test: { method: 'GET', path: '/v2/users/me' },
  capabilities: [
    {
      name: 'tickets.search',
      class: 'read',
      description: 'Search Help Scout conversations using the documented query DSL (e.g. status:active subject:"login").',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          size: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/v2/conversations',
        query: { query: '{query}', page: '{page}', size: '{size}' },
      },
      requiredScopes: ['tickets.search.read'],
    },
    {
      name: 'tickets.read',
      class: 'read',
      description: 'Read a single Help Scout conversation by id.',
      parameters: conversationParams,
      request: { method: 'GET', path: '/v2/conversations/{conversationId}' },
      requiredScopes: ['tickets.search.read'],
    },
    {
      name: 'customers.read',
      class: 'read',
      description: 'Read a Help Scout customer profile.',
      parameters: {
        type: 'object',
        properties: { customerId: { type: 'string' } },
        required: ['customerId'],
      },
      request: { method: 'GET', path: '/v2/customers/{customerId}' },
      requiredScopes: ['customers.read'],
    },
    {
      name: 'tickets.reply',
      class: 'mutation',
      description: 'Post a reply on a Help Scout conversation (creates a customer-visible reply thread).',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
          text: { type: 'string' },
          customer: { type: 'object' },
          user: { type: 'integer' },
          attachments: { type: 'array', items: { type: 'object' } },
        },
        required: ['conversationId', 'text', 'customer'],
      },
      request: {
        method: 'POST',
        path: '/v2/conversations/{conversationId}/reply',
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['tickets.reply.write'],
    },
    {
      name: 'tickets.update',
      class: 'mutation',
      description: 'Update conversation status, assignee, or tags via a JSON-patch op.',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
          op: { type: 'string', enum: ['replace', 'add', 'remove', 'move'] },
          path: { type: 'string' },
          value: {},
        },
        required: ['conversationId', 'op', 'path'],
      },
      request: {
        method: 'PATCH',
        path: '/v2/conversations/{conversationId}',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['tickets.reply.write'],
    },
    {
      name: 'conversations.create',
      class: 'mutation',
      description:
        'Create a new Help Scout conversation (support ticket). Caller supplies subject, customer, mailboxId and the initial thread payload. Help Scout assigns a unique conversation id.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          customer: {
            type: 'object',
            description: 'Customer envelope: { email } at minimum; full Help Scout customer schema accepted.',
          },
          mailboxId: { type: 'integer' },
          type: { type: 'string', enum: ['email', 'chat', 'phone'] },
          status: { type: 'string', enum: ['active', 'pending', 'closed', 'spam'] },
          threads: {
            type: 'array',
            description: 'Initial thread payload — at least one thread is required by the upstream API.',
            items: { type: 'object' },
          },
          tags: { type: 'array', items: { type: 'string' } },
          assignTo: { type: 'integer' },
        },
        required: ['subject', 'customer', 'mailboxId', 'type', 'threads'],
      },
      request: {
        method: 'POST',
        path: '/v2/conversations',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['tickets.reply.write'],
    },
    {
      name: 'conversations.delete',
      class: 'mutation',
      description:
        'Delete a Help Scout conversation. Help Scout returns 204 on success; a second delete returns 404 (treated as committed-replay by the caller).',
      parameters: {
        type: 'object',
        properties: { conversationId: { type: 'string' } },
        required: ['conversationId'],
      },
      request: {
        method: 'DELETE',
        path: '/v2/conversations/{conversationId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['tickets.reply.write'],
    },
  ],
})
