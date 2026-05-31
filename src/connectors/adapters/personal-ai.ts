import { declarativeRestConnector } from './declarative-rest.js'

export const personalAiConnector = declarativeRestConnector({
  kind: 'personal-ai',
  displayName: 'Personal AI',
  description: 'Manage memory storage, messaging, and documents through AI integration.',
  auth: { kind: 'api-key', hint: 'Personal AI API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.personal-ai.com/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'memory.create',
      class: 'mutation',
      description: 'Create a new memory with ChatGPT instruction text and optional context.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The instruction or prompt to send to ChatGPT' },
          context: { type: 'string', description: 'Additional context for the AI response' },
          domainName: { type: 'string', description: 'The domain identifier for the AI profile' },
          userName: { type: 'string', description: 'Name of the user sending the request' },
          sessionId: { type: 'string', description: 'Use the same sessionId to continue conversation' },
          sourceName: { type: 'string', description: 'Name of the source app of the inbound instruction' },
          isStack: { type: 'boolean', description: 'Flag to also add the user instruction to memory' },
        },
        required: ['text'],
      },
      request: {
        method: 'POST',
        path: '/memory',
        body: {
          text: '{text}',
          context: '{context}',
          domainName: '{domainName}',
          userName: '{userName}',
          sessionId: '{sessionId}',
          sourceName: '{sourceName}',
          isStack: '{isStack}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'message.create',
      class: 'mutation',
      description: 'Create a new message in a conversation.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The message text' },
          channelId: { type: 'string', description: 'The unique identifier for the conversation channel' },
          isDraft: { type: 'boolean', description: 'Flag to create a copilot message for the AI' },
        },
        required: ['text', 'channelId'],
      },
      request: {
        method: 'POST',
        path: '/messages',
        body: {
          text: '{text}',
          channelId: '{channelId}',
          isDraft: '{isDraft}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversation.get',
      class: 'read',
      description: 'Get messages from a conversation channel with optional pagination.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string', description: 'The unique identifier for the conversation channel' },
          limit: { type: 'integer', description: 'Maximum number of messages to return' },
          skip: { type: 'integer', description: 'Number of messages to skip for pagination' },
        },
        required: ['channelId'],
      },
      request: {
        method: 'GET',
        path: '/conversations/{channelId}',
        query: { limit: '{limit}', skip: '{skip}' },
      },
    },
    {
      name: 'training.create',
      class: 'mutation',
      description: 'Create custom training data for the AI.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The training instruction text' },
          context: { type: 'string', description: 'Additional context for training' },
        },
        required: ['text'],
      },
      request: {
        method: 'POST',
        path: '/training',
        body: {
          text: '{text}',
          context: '{context}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'document.get',
      class: 'read',
      description: 'Get a document by ID with optional content inclusion.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The unique identifier of the document' },
          includeContent: { type: 'boolean', description: 'Flag to include the document content in response' },
        },
        required: ['documentId'],
      },
      request: {
        method: 'GET',
        path: '/documents/{documentId}',
        query: { includeContent: '{includeContent}' },
      },
    },
    {
      name: 'document.upload',
      class: 'mutation',
      description: 'Upload a document with file or URL.',
      parameters: {
        type: 'object',
        properties: {
          fileName: { type: 'string', description: 'Name of the file to be uploaded' },
          url: { type: 'string', description: 'The URL of the content to upload' },
        },
        required: ['fileName'],
      },
      request: {
        method: 'POST',
        path: '/documents/upload',
        body: {
          fileName: '{fileName}',
          url: '{url}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'document.update',
      class: 'mutation',
      description: 'Update a document with new metadata.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The unique identifier of the document' },
          title: { type: 'string', description: 'Updated title of the document' },
          tags: { type: 'string', description: 'Comma delimited list of tags for the document' },
          createdTime: { type: 'string', description: 'Time (including timezone) of document creation' },
        },
        required: ['documentId'],
      },
      request: {
        method: 'PATCH',
        path: '/documents/{documentId}',
        body: {
          title: '{title}',
          tags: '{tags}',
          createdTime: '{createdTime}',
        },
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
