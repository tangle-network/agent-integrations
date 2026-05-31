import { declarativeRestConnector } from './declarative-rest.js'

export const medullarConnector = declarativeRestConnector({
  kind: 'medullar',
  displayName: 'Medullar',
  description: 'AI-powered discovery & insight platform that acts as your extended digital mind.',
  auth: { kind: 'api-key', hint: 'Medullar API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.medullar.com/v1',
  test: { method: 'GET', path: '/spaces' },
  capabilities: [
    {
      name: 'spaces.list',
      class: 'read',
      description: 'List all spaces.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/spaces' },
    },
    {
      name: 'spaces.create',
      class: 'mutation',
      description: 'Create a new space.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      request: { method: 'POST', path: '/spaces', body: { name: '{name}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'spaces.rename',
      class: 'mutation',
      description: 'Rename an existing space.',
      parameters: {
        type: 'object',
        properties: { spaceId: { type: 'string' }, name: { type: 'string' } },
        required: ['spaceId', 'name'],
      },
      request: { method: 'PATCH', path: '/spaces/{spaceId}', body: { name: '{name}' } },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'spaces.delete',
      class: 'mutation',
      description: 'Delete a space.',
      parameters: {
        type: 'object',
        properties: { spaceId: { type: 'string' } },
        required: ['spaceId'],
      },
      request: { method: 'DELETE', path: '/spaces/{spaceId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'records.add',
      class: 'mutation',
      description: 'Add a record to a space.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string' },
          content: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['spaceId', 'content'],
      },
      request: {
        method: 'POST',
        path: '/spaces/{spaceId}/records',
        body: { content: '{content}', url: '{url}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'ask.space',
      class: 'mutation',
      description: 'Ask a question to a space with AI analysis.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string' },
          message: { type: 'string' },
          reasoning: { type: 'boolean' },
        },
        required: ['spaceId', 'message'],
      },
      request: {
        method: 'POST',
        path: '/spaces/{spaceId}/ask',
        body: { message: '{message}', reasoning: '{reasoning}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
