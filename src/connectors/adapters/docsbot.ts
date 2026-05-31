import { declarativeRestConnector } from './declarative-rest.js'

export const docsbotConnector = declarativeRestConnector({
  kind: 'docsbot',
  displayName: 'DocsBot',
  description:
    'Build AI-powered chatbots that pull answers from your documentation and dynamically update training sources.',
  auth: { kind: 'api-key', hint: 'DocsBot API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.docsbot.ai/api',
  test: { method: 'GET', path: '/v1/account' },
  capabilities: [
    {
      name: 'bots.find',
      class: 'read',
      description: 'Find or list bots in your account.',
      parameters: {
        type: 'object',
        properties: { botId: { type: 'string' } },
        required: [],
      },
      request: { method: 'GET', path: '/v1/bots', query: { botId: '{botId}' } },
    },
    {
      name: 'bots.create',
      class: 'mutation',
      description: 'Create a new DocsBot.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          language: { type: 'string' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/v1/bots', body: { name: '{name}', description: '{description}', language: '{language}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'sources.create',
      class: 'mutation',
      description: 'Create a new training source for a bot.',
      parameters: {
        type: 'object',
        properties: {
          botId: { type: 'string' },
          type: { type: 'string' },
          name: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['botId', 'type', 'name'],
      },
      request: {
        method: 'POST',
        path: '/v1/bots/{botId}/sources',
        body: { type: '{type}', name: '{name}', content: '{content}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sources.upload',
      class: 'mutation',
      description: 'Upload a file as a training source for a bot.',
      parameters: {
        type: 'object',
        properties: {
          botId: { type: 'string' },
          fileName: { type: 'string' },
          fileContent: { type: 'string' },
        },
        required: ['botId', 'fileName', 'fileContent'],
      },
      request: {
        method: 'POST',
        path: '/v1/bots/{botId}/sources/upload',
        body: { fileName: '{fileName}', file: '{fileContent}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.ask',
      class: 'read',
      description: 'Ask a question to a DocsBot.',
      parameters: {
        type: 'object',
        properties: {
          botId: { type: 'string' },
          question: { type: 'string' },
          conversationId: { type: 'string' },
        },
        required: ['botId', 'question'],
      },
      request: {
        method: 'POST',
        path: '/v1/bots/{botId}/conversations/ask',
        body: { question: '{question}', conversationId: '{conversationId}' },
      },
    },
  ],
})
