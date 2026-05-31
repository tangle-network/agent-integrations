import { declarativeRestConnector } from './declarative-rest.js'

export const codyConnector = declarativeRestConnector({
  kind: 'cody',
  displayName: 'Cody',
  description: 'Interact with Cody AI: manage conversations, send messages, upload documents, and search bots.',
  auth: { kind: 'api-key', hint: 'Cody API key from your account settings.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.cody.ai/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'conversations.create',
      class: 'mutation',
      description: 'Create a new conversation with optional focus documents.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Conversation name' },
          document_ids: { type: 'array', items: { type: 'string' }, description: 'Optional document IDs to focus the conversation' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/conversations', body: { name: '{name}', document_ids: '{document_ids}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.find',
      class: 'read',
      description: 'Find conversations by name or list all conversations.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for conversation name' },
          limit: { type: 'integer', description: 'Maximum results to return' },
        },
      },
      request: { method: 'GET', path: '/conversations', query: { q: '{query}', limit: '{limit}' } },
    },
    {
      name: 'messages.send',
      class: 'mutation',
      description: 'Send a message in a conversation.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string', description: 'Conversation ID' },
          content: { type: 'string', description: 'Message content' },
        },
        required: ['conversation_id', 'content'],
      },
      request: { method: 'POST', path: '/conversations/{conversation_id}/messages', body: { content: '{content}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.create',
      class: 'mutation',
      description: 'Create a document from text content.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Text or HTML content (max 768 KB)' },
          title: { type: 'string', description: 'Document title' },
        },
        required: ['content', 'title'],
      },
      request: { method: 'POST', path: '/documents', body: { content: '{content}', title: '{title}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.upload',
      class: 'mutation',
      description: 'Upload a file document (txt, md, rtf, pdf, ppt, docx).',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'File path or base64-encoded content' },
          title: { type: 'string', description: 'Document title' },
        },
        required: ['file', 'title'],
      },
      request: { method: 'POST', path: '/documents/upload', body: { file: '{file}', title: '{title}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'bots.find',
      class: 'read',
      description: 'Find and list available bots.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for bot name' },
          limit: { type: 'integer', description: 'Maximum results to return' },
        },
      },
      request: { method: 'GET', path: '/bots', query: { q: '{query}', limit: '{limit}' } },
    },
  ],
})
