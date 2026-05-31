import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Lucidya adapter — AI-powered social media analytics and customer experience
 * management. The activepieces catalog entry for `lucidya` ships with no
 * actions or triggers (the package only exposes auth wiring), so the
 * capability surface below maps the documented public Lucidya REST API at
 * https://api.lucidya.com.
 *
 * Auth: API key carried as an HTTP Bearer token on every request. The catalog
 * names the credential field `md` (the customer-facing "Measurement Domain"
 * key); the adapter forwards the same token as `Authorization: Bearer <md>`.
 *
 * Category: `crm` (matches the catalog entry; customer-experience tooling).
 */
export const lucidyaConnector = declarativeRestConnector({
  kind: 'lucidya',
  displayName: 'Lucidya',
  description:
    'Query Lucidya social listening data, channels, mentions, sentiment, and tickets for AI-powered CX workflows.',
  auth: {
    kind: 'api-key',
    hint: 'Lucidya API key from the workspace integrations panel; sent as Authorization: Bearer <key>.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.lucidya.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
  test: { method: 'GET', path: '/v1/account' },
  capabilities: [
    {
      name: 'account.get',
      class: 'read',
      description: 'Fetch the authenticated Lucidya workspace metadata (plan, limits, locale).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/account' },
    },
    {
      name: 'channels.list',
      class: 'read',
      description: 'List configured social channels (Twitter/X, Instagram, Facebook, TikTok, etc.) under the workspace.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          page: { type: 'integer' },
          per_page: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/channels',
        query: { type: '{type}', page: '{page}', per_page: '{per_page}' },
      },
    },
    {
      name: 'channels.get',
      class: 'read',
      description: 'Fetch a single channel by id.',
      parameters: {
        type: 'object',
        properties: { channel_id: { type: 'string' } },
        required: ['channel_id'],
      },
      request: { method: 'GET', path: '/v1/channels/{channel_id}' },
    },
    {
      name: 'mentions.search',
      class: 'read',
      description:
        'Search public mentions across configured channels with optional date range, language, sentiment, and channel filters.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          channel_id: { type: 'string' },
          language: { type: 'string' },
          sentiment: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          page: { type: 'integer' },
          per_page: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/mentions',
        query: {
          query: '{query}',
          channel_id: '{channel_id}',
          language: '{language}',
          sentiment: '{sentiment}',
          from: '{from}',
          to: '{to}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'mentions.get',
      class: 'read',
      description: 'Fetch a single mention by id with full author, content, and sentiment payload.',
      parameters: {
        type: 'object',
        properties: { mention_id: { type: 'string' } },
        required: ['mention_id'],
      },
      request: { method: 'GET', path: '/v1/mentions/{mention_id}' },
    },
    {
      name: 'mentions.assign',
      class: 'mutation',
      description: 'Assign a mention to an agent for follow-up in the unified inbox.',
      parameters: {
        type: 'object',
        properties: {
          mention_id: { type: 'string' },
          agent_id: { type: 'string' },
        },
        required: ['mention_id', 'agent_id'],
      },
      request: {
        method: 'POST',
        path: '/v1/mentions/{mention_id}/assign',
        body: { agent_id: '{agent_id}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'mentions.tag',
      class: 'mutation',
      description: 'Add one or more tags to a mention for categorisation and reporting.',
      parameters: {
        type: 'object',
        properties: {
          mention_id: { type: 'string' },
          tags: { type: 'array' },
        },
        required: ['mention_id', 'tags'],
      },
      request: {
        method: 'POST',
        path: '/v1/mentions/{mention_id}/tags',
        body: { tags: '{tags}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'mentions.reply',
      class: 'mutation',
      description: 'Post a public reply to a mention on its originating channel.',
      parameters: {
        type: 'object',
        properties: {
          mention_id: { type: 'string' },
          message: { type: 'string' },
          attachments: { type: 'array' },
        },
        required: ['mention_id', 'message'],
      },
      request: {
        method: 'POST',
        path: '/v1/mentions/{mention_id}/reply',
        body: { message: '{message}', attachments: '{attachments}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tickets.list',
      class: 'read',
      description: 'List CX tickets created from mentions, optionally filtered by status, priority, or assignee.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          priority: { type: 'string' },
          assignee_id: { type: 'string' },
          page: { type: 'integer' },
          per_page: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/tickets',
        query: {
          status: '{status}',
          priority: '{priority}',
          assignee_id: '{assignee_id}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'tickets.get',
      class: 'read',
      description: 'Fetch a single ticket with its full conversation history.',
      parameters: {
        type: 'object',
        properties: { ticket_id: { type: 'string' } },
        required: ['ticket_id'],
      },
      request: { method: 'GET', path: '/v1/tickets/{ticket_id}' },
    },
    {
      name: 'tickets.create',
      class: 'mutation',
      description: 'Create a CX ticket from a mention or stand-alone subject for manual triage.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          description: { type: 'string' },
          mention_id: { type: 'string' },
          priority: { type: 'string' },
          assignee_id: { type: 'string' },
          tags: { type: 'array' },
        },
        required: ['subject'],
      },
      request: {
        method: 'POST',
        path: '/v1/tickets',
        body: {
          subject: '{subject}',
          description: '{description}',
          mention_id: '{mention_id}',
          priority: '{priority}',
          assignee_id: '{assignee_id}',
          tags: '{tags}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tickets.update',
      class: 'mutation',
      description: 'Update ticket status, priority, assignee, or tags.',
      parameters: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string' },
          status: { type: 'string' },
          priority: { type: 'string' },
          assignee_id: { type: 'string' },
          tags: { type: 'array' },
        },
        required: ['ticket_id'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/tickets/{ticket_id}',
        body: {
          status: '{status}',
          priority: '{priority}',
          assignee_id: '{assignee_id}',
          tags: '{tags}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'analytics.sentiment',
      class: 'read',
      description: 'Aggregate sentiment breakdown (positive/neutral/negative) for a query and date range.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          channel_id: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          granularity: { type: 'string' },
        },
        required: ['from', 'to'],
      },
      request: {
        method: 'GET',
        path: '/v1/analytics/sentiment',
        query: {
          query: '{query}',
          channel_id: '{channel_id}',
          from: '{from}',
          to: '{to}',
          granularity: '{granularity}',
        },
      },
    },
    {
      name: 'analytics.volume',
      class: 'read',
      description: 'Time-series mention volume for a query and date range bucketed by granularity.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          channel_id: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          granularity: { type: 'string' },
        },
        required: ['from', 'to'],
      },
      request: {
        method: 'GET',
        path: '/v1/analytics/volume',
        query: {
          query: '{query}',
          channel_id: '{channel_id}',
          from: '{from}',
          to: '{to}',
          granularity: '{granularity}',
        },
      },
    },
    {
      name: 'analytics.topics',
      class: 'read',
      description: 'AI-extracted topic clusters with mention counts for a query and date range.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          channel_id: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['from', 'to'],
      },
      request: {
        method: 'GET',
        path: '/v1/analytics/topics',
        query: {
          query: '{query}',
          channel_id: '{channel_id}',
          from: '{from}',
          to: '{to}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'reports.list',
      class: 'read',
      description: 'List saved analytics reports under the workspace.',
      parameters: {
        type: 'object',
        properties: { page: { type: 'integer' }, per_page: { type: 'integer' } },
      },
      request: {
        method: 'GET',
        path: '/v1/reports',
        query: { page: '{page}', per_page: '{per_page}' },
      },
    },
    {
      name: 'reports.get',
      class: 'read',
      description: 'Fetch a single saved report definition by id.',
      parameters: {
        type: 'object',
        properties: { report_id: { type: 'string' } },
        required: ['report_id'],
      },
      request: { method: 'GET', path: '/v1/reports/{report_id}' },
    },
  ],
})
