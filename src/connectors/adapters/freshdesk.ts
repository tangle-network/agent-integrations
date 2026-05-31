import { declarativeRestConnector } from './declarative-rest.js'

// Freshdesk REST + OAuth endpoints are scoped to a per-account subdomain
// (https://{subdomain}.freshdesk.com). The OAuth orchestrator substitutes
// `{subdomain}` from connection metadata before building the authorize
// redirect; the executor reads `metadata.subdomainUrl` to resolve baseUrl
// (same per-tenant-host pattern Zendesk uses).
//
// Docs:
//   API:   https://developers.freshdesk.com/api/
//   OAuth: https://developers.freshdesk.com/v2/docs/oauth/
// The platform-level scope label `freshdesk.api` mirrors Freshdesk's single
// account-wide API scope; capability-level enforcement at the hub still
// distinguishes read vs. write actions via `requiredScopes` on each op.

export const freshdeskConnector = declarativeRestConnector({
  kind: 'freshdesk',
  displayName: 'Freshdesk',
  description: 'Search, read, create, and update Freshdesk support tickets, contacts, and conversations.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://{subdomain}.freshdesk.com/oauth/authorize',
    tokenUrl: 'https://{subdomain}.freshdesk.com/oauth/token',
    scopes: ['freshdesk.api'],
    clientIdEnv: 'FRESHDESK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FRESHDESK_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'subdomainUrl' },
  test: { method: 'GET', path: '/api/v2/agents/me' },
  capabilities: [
    {
      name: 'tickets.search',
      class: 'read',
      description:
        'Search Freshdesk tickets using the documented filter query DSL (e.g. "status:2 AND priority:3"). Wrap the expression in double quotes per the Freshdesk API.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/search/tickets',
        query: { query: '{query}', page: '{page}' },
      },
      requiredScopes: ['freshdesk.api'],
    },
    {
      name: 'tickets.list',
      class: 'read',
      description: 'List Freshdesk tickets with optional filter (new_and_my_open, watching, spam, deleted) and pagination.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['new_and_my_open', 'watching', 'spam', 'deleted'] },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          updated_since: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/tickets',
        query: {
          filter: '{filter}',
          page: '{page}',
          per_page: '{per_page}',
          updated_since: '{updated_since}',
        },
      },
      requiredScopes: ['freshdesk.api'],
    },
    {
      name: 'tickets.get',
      class: 'read',
      description: 'Read a single Freshdesk ticket by id, with optional `include` expansions (conversations, requester, company, stats).',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          include: { type: 'string' },
        },
        required: ['ticketId'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/tickets/{ticketId}',
        query: { include: '{include}' },
      },
      requiredScopes: ['freshdesk.api'],
    },
    {
      name: 'tickets.create',
      class: 'mutation',
      description: 'Create a Freshdesk ticket. Pass the full Freshdesk ticket payload as the top-level args (subject, description, email/requester_id, priority, status, ...).',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          description: { type: 'string' },
          email: { type: 'string' },
          requester_id: { type: 'integer' },
          phone: { type: 'string' },
          priority: { type: 'integer', minimum: 1, maximum: 4 },
          status: { type: 'integer', minimum: 2, maximum: 5 },
          source: { type: 'integer' },
          type: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          cc_emails: { type: 'array', items: { type: 'string' } },
          custom_fields: { type: 'object' },
          group_id: { type: 'integer' },
          responder_id: { type: 'integer' },
        },
        required: ['subject', 'description', 'status', 'priority'],
      },
      request: { method: 'POST', path: '/api/v2/tickets', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['freshdesk.api'],
    },
    {
      name: 'tickets.update',
      class: 'mutation',
      description: 'Update a Freshdesk ticket (status, priority, assignee, tags, custom_fields, ...). Pass `ticketId` plus any updatable fields.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          subject: { type: 'string' },
          priority: { type: 'integer', minimum: 1, maximum: 4 },
          status: { type: 'integer', minimum: 2, maximum: 5 },
          tags: { type: 'array', items: { type: 'string' } },
          group_id: { type: 'integer' },
          responder_id: { type: 'integer' },
          type: { type: 'string' },
          custom_fields: { type: 'object' },
        },
        required: ['ticketId'],
      },
      request: {
        method: 'PUT',
        path: '/api/v2/tickets/{ticketId}',
        body: {
          subject: '{subject}',
          priority: '{priority}',
          status: '{status}',
          tags: '{tags}',
          group_id: '{group_id}',
          responder_id: '{responder_id}',
          type: '{type}',
          custom_fields: '{custom_fields}',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['freshdesk.api'],
    },
    {
      name: 'tickets.reply',
      class: 'mutation',
      description: 'Post a public reply on a Freshdesk ticket. Body becomes a customer-visible response on the ticket thread.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          body: { type: 'string' },
          from_email: { type: 'string' },
          user_id: { type: 'integer' },
          cc_emails: { type: 'array', items: { type: 'string' } },
          bcc_emails: { type: 'array', items: { type: 'string' } },
          attachments: { type: 'array', items: { type: 'object' } },
        },
        required: ['ticketId', 'body'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/tickets/{ticketId}/reply',
        body: {
          body: '{body}',
          from_email: '{from_email}',
          user_id: '{user_id}',
          cc_emails: '{cc_emails}',
          bcc_emails: '{bcc_emails}',
          attachments: '{attachments}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['freshdesk.api'],
    },
    {
      name: 'tickets.note',
      class: 'mutation',
      description: 'Add a note (private by default, set `private: false` for public) to a Freshdesk ticket.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          body: { type: 'string' },
          private: { type: 'boolean' },
          incoming: { type: 'boolean' },
          user_id: { type: 'integer' },
          notify_emails: { type: 'array', items: { type: 'string' } },
        },
        required: ['ticketId', 'body'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/tickets/{ticketId}/notes',
        body: {
          body: '{body}',
          private: '{private}',
          incoming: '{incoming}',
          user_id: '{user_id}',
          notify_emails: '{notify_emails}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['freshdesk.api'],
    },
    {
      name: 'contacts.search',
      class: 'read',
      description: 'Search Freshdesk contacts using the documented filter query DSL (e.g. "email:\'ada@example.com\'").',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/search/contacts',
        query: { query: '{query}', page: '{page}' },
      },
      requiredScopes: ['freshdesk.api'],
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a Freshdesk contact. Requires `name` plus at least one of `email`, `phone`, `mobile`, `twitter_id`, or `unique_external_id`.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          mobile: { type: 'string' },
          twitter_id: { type: 'string' },
          unique_external_id: { type: 'string' },
          company_id: { type: 'integer' },
          address: { type: 'string' },
          description: { type: 'string' },
          job_title: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          custom_fields: { type: 'object' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/api/v2/contacts', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['freshdesk.api'],
    },
  ],
})
