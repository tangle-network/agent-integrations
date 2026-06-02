import { declarativeRestConnector } from './declarative-rest.js'

export const chatbaseConnector = declarativeRestConnector({
  kind: 'chatbase',
  displayName: 'Chatbase',
  description: 'Build and manage AI chatbots with custom sources via the Chatbase API.',
  auth: { kind: 'api-key', hint: 'Chatbase secret API key (Bearer token).' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://www.chatbase.co/api/v1',
  test: { method: 'GET', path: '/get-chatbots' },
  capabilities: [
    {
      name: 'chatbot.create',
      class: 'mutation',
      description: 'Create a new Chatbase chatbot with optional source text.',
      parameters: {
        type: 'object',
        properties: {
          chatbotName: { type: 'string', description: 'Human-readable chatbot name.' },
          sourceText: {
            type: 'string',
            description: 'Optional text data used to seed the chatbot training corpus.',
          },
        },
        required: ['chatbotName'],
      },
      request: {
        method: 'POST',
        path: '/create-chatbot',
        body: { chatbotName: '{chatbotName}', sourceText: '{sourceText}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'chatbot.list',
      class: 'read',
      description: 'List all chatbots owned by the authenticated Chatbase account.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'GET',
        path: '/get-chatbots',
      },
    },
    {
      name: 'conversations.search',
      class: 'read',
      description: 'Search conversations across a chatbot, optionally filtering by source and date.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'Chatbase chatbot id.' },
          filteredSources: {
            type: 'string',
            description: 'Comma-separated list of conversation sources to include.',
          },
          startDate: { type: 'string', description: 'ISO start date (inclusive).' },
          endDate: { type: 'string', description: 'ISO end date (inclusive).' },
          page: { type: 'integer', description: 'Pagination page (default 1).' },
          size: { type: 'integer', description: 'Page size (default 10, max 100).' },
        },
        required: ['chatbotId'],
      },
      request: {
        method: 'GET',
        path: '/get-conversations',
        query: {
          chatbotId: '{chatbotId}',
          filteredSources: '{filteredSources}',
          startDate: '{startDate}',
          endDate: '{endDate}',
          page: '{page}',
          size: '{size}',
        },
      },
    },
    {
      name: 'chatbot.prompt',
      class: 'mutation',
      description: 'Send a prompt to a chatbot and receive a generated response.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'Chatbase chatbot id.' },
          message: { type: 'string', description: 'User prompt to send to the chatbot.' },
          temperature: {
            type: 'number',
            description: 'Sampling temperature between 0 and 1; higher values produce more random output.',
          },
          conversationId: {
            type: 'string',
            description: 'Optional id for grouping turns into a persisted conversation.',
          },
          model: {
            type: 'string',
            description: 'Optional model identifier to override the chatbot default.',
          },
        },
        required: ['chatbotId', 'message'],
      },
      request: {
        method: 'POST',
        path: '/chat',
        body: {
          chatbotId: '{chatbotId}',
          messages: [{ role: 'user', content: '{message}' }],
          temperature: '{temperature}',
          conversationId: '{conversationId}',
          model: '{model}',
          stream: false,
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'chatbot.update',
      class: 'mutation',
      description: 'Update a chatbot configuration (name, model, prompt, temperature, visibility).',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'Chatbase chatbot id.' },
          chatbotName: { type: 'string', description: 'New chatbot name.' },
          model: { type: 'string', description: 'Model identifier to use.' },
          basePrompt: { type: 'string', description: 'System prompt.' },
          temperature: { type: 'number' },
          visibility: { type: 'string', enum: ['public', 'private'] },
        },
        required: ['chatbotId'],
      },
      request: {
        method: 'PATCH',
        path: '/update-chatbot',
        body: {
          chatbotId: '{chatbotId}',
          chatbotName: '{chatbotName}',
          model: '{model}',
          basePrompt: '{basePrompt}',
          temperature: '{temperature}',
          visibility: '{visibility}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'chatbot.delete',
      class: 'mutation',
      description: 'Delete a chatbot.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'Chatbase chatbot id.' },
        },
        required: ['chatbotId'],
      },
      request: {
        method: 'POST',
        path: '/delete-chatbot',
        body: { chatbotId: '{chatbotId}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'sources.upload',
      class: 'mutation',
      description: 'Upload a knowledge source (text, URL, or file content) to a chatbot.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'Chatbase chatbot id.' },
          type: {
            type: 'string',
            enum: ['text', 'url', 'file'],
            description: 'Source type.',
          },
          content: {
            type: 'string',
            description: 'Raw text, URL, or base64-encoded file content depending on type.',
          },
          filename: { type: 'string', description: 'Optional filename for file uploads.' },
        },
        required: ['chatbotId', 'type', 'content'],
      },
      request: {
        method: 'POST',
        path: '/upload-source',
        body: {
          chatbotId: '{chatbotId}',
          type: '{type}',
          content: '{content}',
          filename: '{filename}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'sources.delete',
      class: 'mutation',
      description: 'Delete a knowledge source from a chatbot.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'Chatbase chatbot id.' },
          sourceId: { type: 'string', description: 'Knowledge source id to delete.' },
        },
        required: ['chatbotId', 'sourceId'],
      },
      request: {
        method: 'POST',
        path: '/delete-source',
        body: {
          chatbotId: '{chatbotId}',
          sourceId: '{sourceId}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
