import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Hedy AI-powered meeting intelligence connector.
 *
 * Authentication: API key delivered in the `Authorization: Bearer` header.
 * Region selection (US vs EU) is configurable at credential time.
 *
 * Capability surface covers meeting session management and topic creation:
 *   - topics: create, read, update, list
 *   - sessions: get details, list by topic
 *   - context: create and manage session context for AI analysis
 */

export const hedyConnector = declarativeRestConnector({
  kind: 'hedy',
  displayName: 'Hedy',
  description:
    'AI-powered meeting intelligence — manage topics, sessions, and custom context for meeting analysis and insights.',
  auth: {
    kind: 'api-key',
    hint: 'Hedy API key. Generate one from your Hedy dashboard under Settings → API.',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.hedy.ai',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Bearer ' },
  test: { method: 'GET', path: '/v1/topics' },
  capabilities: [
    {
      name: 'topics.create',
      class: 'mutation',
      description:
        'Create a new topic for organizing meetings and sessions within Hedy.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the topic (max 100 characters).' },
          description: {
            type: 'string',
            description: 'Description of the topic (max 500 characters).',
          },
          color: {
            type: 'string',
            description: 'Hex color code for the topic (e.g., #4A90D9).',
          },
          iconName: {
            type: 'string',
            description: 'Material icon name for the topic (e.g., groups).',
          },
          topicContext: {
            type: 'string',
            description:
              'Custom instructions for AI processing of sessions in this topic (max 20,000 characters).',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/v1/topics',
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'topics.get',
      class: 'read',
      description: 'Retrieve details for a specific topic.',
      parameters: {
        type: 'object',
        properties: {
          topicId: {
            type: 'string',
            description: 'The unique identifier of the topic.',
          },
        },
        required: ['topicId'],
      },
      request: {
        method: 'GET',
        path: '/v1/topics/{topicId}',
      },
    },
    {
      name: 'topics.list',
      class: 'read',
      description: 'List all topics in your Hedy workspace.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: 'Maximum number of topics to return (default 50).',
          },
          offset: {
            type: 'integer',
            description: 'Pagination offset (default 0).',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/topics',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'topics.update',
      class: 'mutation',
      description: 'Update an existing topic.',
      parameters: {
        type: 'object',
        properties: {
          topicId: {
            type: 'string',
            description: 'The unique identifier of the topic.',
          },
          name: {
            type: 'string',
            description: 'Updated topic name.',
          },
          description: {
            type: 'string',
            description: 'Updated topic description.',
          },
          color: {
            type: 'string',
            description: 'Updated hex color code.',
          },
          iconName: {
            type: 'string',
            description: 'Updated Material icon name.',
          },
          topicContext: {
            type: 'string',
            description: 'Updated custom AI processing instructions.',
          },
        },
        required: ['topicId'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/topics/{topicId}',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'sessions.get',
      class: 'read',
      description: 'Get details for a specific meeting session.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'The unique identifier of the session.',
          },
        },
        required: ['sessionId'],
      },
      request: {
        method: 'GET',
        path: '/v1/sessions/{sessionId}',
      },
    },
    {
      name: 'sessions.list_by_topic',
      class: 'read',
      description: 'List all sessions within a specific topic.',
      parameters: {
        type: 'object',
        properties: {
          topicId: {
            type: 'string',
            description: 'The topic ID to list sessions from.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of sessions to return (default 50).',
          },
          offset: {
            type: 'integer',
            description: 'Pagination offset (default 0).',
          },
        },
        required: ['topicId'],
      },
      request: {
        method: 'GET',
        path: '/v1/topics/{topicId}/sessions',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'context.create',
      class: 'mutation',
      description:
        'Create or update a session context — custom instructions or domain knowledge for AI analysis of meetings in a topic.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the session context (max 200 characters).',
          },
          content: {
            type: 'string',
            description: 'Instructions or context for AI analysis (max 20,000 characters).',
          },
          isDefault: {
            type: 'boolean',
            description: 'Whether this context should be the default for new sessions.',
          },
        },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/v1/context',
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'context.get',
      class: 'read',
      description: 'Retrieve a specific session context by ID.',
      parameters: {
        type: 'object',
        properties: {
          contextId: {
            type: 'string',
            description: 'The unique identifier of the context.',
          },
        },
        required: ['contextId'],
      },
      request: {
        method: 'GET',
        path: '/v1/context/{contextId}',
      },
    },
  ],
})
