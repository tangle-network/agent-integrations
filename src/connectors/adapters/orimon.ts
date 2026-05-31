import { declarativeRestConnector } from './declarative-rest.js'

export const orimonConnector = declarativeRestConnector({
  kind: 'orimon',
  displayName: 'Orimon',
  description: 'Send messages to Orimon chatbots and manage conversations.',
  auth: {
    kind: 'api-key',
    hint: 'Orimon API credentials (Tenant ID and API key).',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.orimon.com/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'messages.send',
      class: 'mutation',
      description: 'Send a message to an Orimon chatbot.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'Tenant ID from Orimon dashboard.' },
          messageText: { type: 'string', description: 'The message to send.' },
          messageId: { type: 'string', description: 'Optional unique identifier for this message.' },
          markdown: { type: 'boolean', description: 'Whether the message uses markdown formatting.' },
        },
        required: ['tenantId', 'messageText', 'markdown'],
      },
      request: {
        method: 'POST',
        path: '/tenants/{tenantId}/messages',
        body: {
          message: '{messageText}',
          messageId: '{messageId}',
          markdown: '{markdown}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.list',
      class: 'read',
      description: 'List conversations for a tenant.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'Tenant ID.' },
          limit: { type: 'integer', description: 'Maximum number of conversations to return.' },
          offset: { type: 'integer', description: 'Pagination offset.' },
        },
        required: ['tenantId'],
      },
      request: {
        method: 'GET',
        path: '/tenants/{tenantId}/conversations',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'conversations.get',
      class: 'read',
      description: 'Get details of a specific conversation.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'Tenant ID.' },
          conversationId: { type: 'string', description: 'Conversation ID.' },
        },
        required: ['tenantId', 'conversationId'],
      },
      request: {
        method: 'GET',
        path: '/tenants/{tenantId}/conversations/{conversationId}',
      },
    },
    {
      name: 'conversations.close',
      class: 'mutation',
      description: 'Close a conversation.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'Tenant ID.' },
          conversationId: { type: 'string', description: 'Conversation ID to close.' },
        },
        required: ['tenantId', 'conversationId'],
      },
      request: {
        method: 'POST',
        path: '/tenants/{tenantId}/conversations/{conversationId}/close',
        body: {},
      },
      cas: 'native-idempotency',
    },
    {
      name: 'leads.create',
      class: 'mutation',
      description: 'Create a new lead from a conversation.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'Tenant ID.' },
          conversationId: { type: 'string', description: 'Conversation ID.' },
          name: { type: 'string', description: 'Lead name.' },
          email: { type: 'string', description: 'Lead email address.' },
          phone: { type: 'string', description: 'Lead phone number.' },
          metadata: { type: 'object', description: 'Additional lead metadata.' },
        },
        required: ['tenantId', 'conversationId', 'name', 'email'],
      },
      request: {
        method: 'POST',
        path: '/tenants/{tenantId}/leads',
        body: {
          conversationId: '{conversationId}',
          name: '{name}',
          email: '{email}',
          phone: '{phone}',
          metadata: '{metadata}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
