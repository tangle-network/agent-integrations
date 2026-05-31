import { declarativeRestConnector } from './declarative-rest.js'

export const pastefyConnector = declarativeRestConnector({
  kind: 'pastefy',
  displayName: 'Pastefy',
  description: 'Create and retrieve code snippets on Pastefy.',
  auth: {
    kind: 'api-key',
    hint: 'Pastefy instance URL and API token.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instance_url' },
  test: { method: 'GET', path: '/api/v1/pastes' },
  capabilities: [
    {
      name: 'pastes.list',
      class: 'read',
      description: 'List all pastes.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: {
        method: 'GET',
        path: '/api/v1/pastes',
      },
    },
    {
      name: 'pastes.get',
      class: 'read',
      description: 'Retrieve a specific paste by ID.',
      parameters: {
        type: 'object',
        properties: {
          paste_id: { type: 'string' },
        },
        required: ['paste_id'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/pastes/{paste_id}',
      },
    },
    {
      name: 'pastes.create',
      class: 'mutation',
      description: 'Create a new code snippet paste.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          content: { type: 'string' },
          title: { type: 'string' },
          password: { type: 'string' },
          expiry: { type: 'string' },
        },
        required: ['name', 'content'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/pastes',
        body: {
          name: '{name}',
          content: '{content}',
          title: '{title}',
          password: '{password}',
          expiry: '{expiry}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'pastes.delete',
      class: 'mutation',
      description: 'Delete a paste by ID.',
      parameters: {
        type: 'object',
        properties: {
          paste_id: { type: 'string' },
        },
        required: ['paste_id'],
      },
      request: {
        method: 'DELETE',
        path: '/api/v1/pastes/{paste_id}',
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
