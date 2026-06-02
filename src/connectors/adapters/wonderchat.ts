import { declarativeRestConnector } from './declarative-rest.js'

export const wonderchatConnector = declarativeRestConnector({
  kind: 'wonderchat',
  displayName: 'Wonderchat',
  description: 'Interact with Wonderchat chatbots: ask questions, manage pages and tags.',
  auth: { kind: 'api-key', hint: 'Wonderchat API key from your account settings.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.wonderchat.io/api',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'question.ask',
      class: 'read',
      description: 'Ask a question to a Wonderchat chatbot.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The ID of your chatbot' },
          chatlogId: { type: 'string', description: 'The ID of your chat session' },
          question: { type: 'string', description: 'The question to ask the chatbot' },
          context: { type: 'string', description: 'Additional custom context about the chat session' },
          contextUrl: { type: 'string', description: 'URL of the page for additional context' },
        },
        required: ['chatbotId', 'chatlogId', 'question'],
      },
      request: {
        method: 'POST',
        path: '/chatbot/{chatbotId}/ask',
        body: { chatlogId: '{chatlogId}', question: '{question}', context: '{context}', contextUrl: '{contextUrl}' },
      },
    },
    {
      name: 'page.add',
      class: 'mutation',
      description: 'Add a webpage to a Wonderchat chatbot for training.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The ID of your chatbot' },
          urls: { type: 'array', items: { type: 'string' }, description: 'List of webpage URLs to add' },
          sessionCookie: { type: 'string', description: 'Session cookie for crawling sites behind login' },
        },
        required: ['chatbotId', 'urls'],
      },
      request: {
        method: 'POST',
        path: '/chatbot/{chatbotId}/pages',
        body: { urls: '{urls}', sessionCookie: '{sessionCookie}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tag.add',
      class: 'mutation',
      description: 'Add a tag to a Wonderchat chatbot.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The ID of your chatbot' },
          tags: { type: 'object', description: 'Tags to add to the chatbot' },
        },
        required: ['chatbotId', 'tags'],
      },
      request: {
        method: 'POST',
        path: '/chatbot/{chatbotId}/tags',
        body: { tags: '{tags}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tag.remove',
      class: 'mutation',
      description: 'Remove a tag from a Wonderchat chatbot.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The ID of your chatbot' },
          tagKey: { type: 'string', description: 'The tag key to remove' },
        },
        required: ['chatbotId', 'tagKey'],
      },
      request: {
        method: 'DELETE',
        path: '/chatbot/{chatbotId}/tags/{tagKey}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'page.remove',
      class: 'mutation',
      description: 'Remove a previously trained page from a Wonderchat chatbot by page id.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The ID of your chatbot' },
          pageId: { type: 'string', description: 'The ID of the page to remove' },
        },
        required: ['chatbotId', 'pageId'],
      },
      request: {
        method: 'DELETE',
        path: '/chatbot/{chatbotId}/pages/{pageId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'bot.train',
      class: 'mutation',
      description: 'Trigger a retrain of the Wonderchat chatbot against its current sources.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The ID of your chatbot' },
        },
        required: ['chatbotId'],
      },
      request: {
        method: 'POST',
        path: '/chatbot/{chatbotId}/train',
        body: {},
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'conversations.list',
      class: 'read',
      description: 'List historical conversations for a Wonderchat chatbot.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The ID of your chatbot' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum conversations to return' },
          cursor: { type: 'string', description: 'Pagination cursor from a previous call' },
        },
        required: ['chatbotId'],
      },
      request: {
        method: 'GET',
        path: '/chatbot/{chatbotId}/conversations',
        query: { limit: '{limit}', cursor: '{cursor}' },
      },
    },
    {
      name: 'conversations.delete',
      class: 'mutation',
      description: 'Delete a stored Wonderchat conversation by chatlog id.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The ID of your chatbot' },
          chatlogId: { type: 'string', description: 'The chatlog id to delete' },
        },
        required: ['chatbotId', 'chatlogId'],
      },
      request: {
        method: 'DELETE',
        path: '/chatbot/{chatbotId}/conversations/{chatlogId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
