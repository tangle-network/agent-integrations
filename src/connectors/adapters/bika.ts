import { declarativeRestConnector } from './declarative-rest.js'

export const bikaConnector = declarativeRestConnector({
  kind: 'bika',
  displayName: 'Bika.ai',
  description: 'Interactive spreadsheets with collaboration. Create, find, update, and delete records.',
  auth: { kind: 'api-key', hint: 'Bika API token.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.bika.ai/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a new record in Bika.',
      parameters: {
        type: 'object',
        properties: { data: { type: 'object' } },
        required: ['data'],
      },
      request: { method: 'POST', path: '/records', body: '{data}' },
      cas: 'native-idempotency',
    },
    {
      name: 'records.find',
      class: 'read',
      description: 'Find records in Bika with optional filtering and pagination.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string' },
          maxRecords: { type: 'integer' },
          pageSize: { type: 'integer' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/records',
        query: { filter: '{filter}', maxRecords: '{maxRecords}', pageSize: '{pageSize}' },
      },
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Get a specific record by ID.',
      parameters: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
      },
      request: { method: 'GET', path: '/records/{recordId}' },
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update an existing record.',
      parameters: {
        type: 'object',
        properties: { recordId: { type: 'string' }, data: { type: 'object' } },
        required: ['recordId', 'data'],
      },
      request: { method: 'PATCH', path: '/records/{recordId}', body: '{data}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record by ID.',
      parameters: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
      },
      request: { method: 'DELETE', path: '/records/{recordId}' },
      cas: 'native-idempotency',
    },
  ],
})
