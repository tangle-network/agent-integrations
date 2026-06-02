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
    {
      name: 'leads.update',
      class: 'mutation',
      description: 'Update an existing lead.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'Tenant ID.' },
          leadId: { type: 'string', description: 'Lead ID to update.' },
          name: { type: 'string', description: 'Updated lead name (optional).' },
          email: { type: 'string', description: 'Updated email (optional).' },
          phone: { type: 'string', description: 'Updated phone (optional).' },
          metadata: { type: 'object', description: 'Updated metadata (optional).' },
        },
        required: ['tenantId', 'leadId'],
      },
      request: {
        method: 'PATCH',
        path: '/tenants/{tenantId}/leads/{leadId}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'leads.delete',
      class: 'mutation',
      description: 'Delete a lead.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'Tenant ID.' },
          leadId: { type: 'string', description: 'Lead ID to delete.' },
        },
        required: ['tenantId', 'leadId'],
      },
      request: {
        method: 'DELETE',
        path: '/tenants/{tenantId}/leads/{leadId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'conversations.assign',
      class: 'mutation',
      description: 'Assign a conversation to an agent.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'Tenant ID.' },
          conversationId: { type: 'string', description: 'Conversation ID to assign.' },
          agentId: { type: 'string', description: 'Agent ID to assign the conversation to.' },
        },
        required: ['tenantId', 'conversationId', 'agentId'],
      },
      request: {
        method: 'POST',
        path: '/tenants/{tenantId}/conversations/{conversationId}/assign',
        body: {
          agentId: '{agentId}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'conversations.tag',
      class: 'mutation',
      description: 'Add a tag to a conversation.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'Tenant ID.' },
          conversationId: { type: 'string', description: 'Conversation ID.' },
          tag: { type: 'string', description: 'Tag to add to the conversation.' },
        },
        required: ['tenantId', 'conversationId', 'tag'],
      },
      request: {
        method: 'POST',
        path: '/tenants/{tenantId}/conversations/{conversationId}/tags',
        body: {
          tag: '{tag}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
