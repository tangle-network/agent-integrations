import { declarativeRestConnector } from './declarative-rest.js'

export const base44Connector = declarativeRestConnector({
  kind: 'base44',
  displayName: 'Base44',
  description: 'Create, find, and manage entities in Base44 with flexible query and filtering capabilities.',
  auth: {
    kind: 'api-key',
    hint: 'Base44 App ID and API token.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.base44.io/api/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'entities.create',
      class: 'mutation',
      description: 'Create a new entity in Base44.',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', description: 'The name of the entity type' },
          entityData: { type: 'object', description: 'The data to create the entity with' },
        },
        required: ['entityType', 'entityData'],
      },
      request: {
        method: 'POST',
        path: '/entities/{entityType}',
        body: '{entityData}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'entities.find',
      class: 'read',
      description: 'Find entities in Base44 matching a search query.',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', description: 'The name of the entity type' },
          searchQuery: { type: 'object', description: 'Query object to filter entities' },
        },
        required: ['entityType', 'searchQuery'],
      },
      request: {
        method: 'POST',
        path: '/entities/{entityType}/search',
        body: '{searchQuery}',
      },
    },
    {
      name: 'entities.findOrCreate',
      class: 'mutation',
      description: 'Find an entity or create it if not found.',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', description: 'The name of the entity type' },
          searchQuery: { type: 'object', description: 'Query to find the entity' },
          createData: { type: 'object', description: 'Data to create the entity with if not found' },
        },
        required: ['entityType', 'searchQuery', 'createData'],
      },
      request: {
        method: 'POST',
        path: '/entities/{entityType}/findOrCreate',
        body: { search: '{searchQuery}', create: '{createData}' },
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
