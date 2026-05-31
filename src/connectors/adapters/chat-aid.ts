import { declarativeRestConnector } from './declarative-rest.js'

export const chatAidConnector = declarativeRestConnector({
  kind: 'chat-aid',
  displayName: 'Chat Aid',
  description: 'AI-powered assistant for your knowledge base. Upload documents, ask questions, and manage custom sources.',
  auth: { kind: 'api-key', hint: 'Chat Aid API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.chat-aid.com/api',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'sources.get',
      class: 'read',
      description: 'Retrieve a custom source by ID.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string' },
        },
        required: ['sourceId'],
      },
      request: { method: 'GET', path: '/sources/{sourceId}' },
    },
    {
      name: 'sources.add',
      class: 'mutation',
      description: 'Add custom sources (upload documents like PDF, Word, Markdown, HTML, Excel, CSV, PowerPoint, images).',
      parameters: {
        type: 'object',
        properties: {
          files: { type: 'object' },
          teamId: { type: 'string' },
        },
        required: ['files'],
      },
      request: {
        method: 'POST',
        path: '/sources/add',
        body: { files: '{files}', teamId: '{teamId}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'questions.ask',
      class: 'mutation',
      description: 'Ask questions to the knowledge base. Optionally thread conversations using parentTs and messageTs.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string' },
          prompt: { type: 'string' },
          teamId: { type: 'string' },
          parentTs: { type: 'string' },
          messageTs: { type: 'string' },
        },
        required: ['sourceId', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/questions/ask',
        body: {
          sourceId: '{sourceId}',
          prompt: '{prompt}',
          teamId: '{teamId}',
          parentTs: '{parentTs}',
          messageTs: '{messageTs}',
        },
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
