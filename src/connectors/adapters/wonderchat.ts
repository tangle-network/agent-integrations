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
    },
  ],
})
