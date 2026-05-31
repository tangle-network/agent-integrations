import { declarativeRestConnector } from './declarative-rest.js'

export const fellowConnector = declarativeRestConnector({
  kind: 'fellow',
  displayName: 'Fellow.ai',
  description: 'AI Meeting Assistant and Notetaker - get notes and manage meeting recordings.',
  auth: { kind: 'api-key', hint: 'Fellow.ai API key from User Settings -> Developer Tools.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiUrl' },
  test: { method: 'GET', path: '/v1/notes' },
  capabilities: [
    {
      name: 'notes.get',
      class: 'read',
      description: 'Get a Fellow.ai note by ID.',
      parameters: {
        type: 'object',
        properties: {
          noteId: { type: 'string' },
        },
        required: ['noteId'],
      },
      request: { method: 'GET', path: '/v1/notes/{noteId}' },
    },
    {
      name: 'notes.list',
      class: 'read',
      description: 'List Fellow.ai notes.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      request: { method: 'GET', path: '/v1/notes', query: { limit: '{limit}', offset: '{offset}' } },
    },
    {
      name: 'recordings.list',
      class: 'read',
      description: 'List meeting recordings.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      request: { method: 'GET', path: '/v1/recordings', query: { limit: '{limit}', offset: '{offset}' } },
    },
  ],
})
