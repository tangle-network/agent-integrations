import { declarativeRestConnector } from './declarative-rest.js'

export const smartsuiteConnector = declarativeRestConnector({
  kind: 'smartsuite',
  displayName: 'SmartSuite',
  description: 'Collaborative work management platform combining databases with spreadsheets.',
  auth: { kind: 'api-key', hint: 'SmartSuite API key and Account ID.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.smartsuite.com/api/v1',
  test: { method: 'GET', path: '/applications' },
  capabilities: [
    {
      name: 'records.find',
      class: 'read',
      description: 'Find records matching search criteria.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string' },
          searchField: { type: 'string' },
          searchValue: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['table', 'searchField', 'searchValue'],
      },
      request: {
        method: 'GET',
        path: '/tables/{table}/records',
        query: { searchField: '{searchField}', searchValue: '{searchValue}', limit: '{limit}' },
      },
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Get a specific record by ID.',
      parameters: {
        type: 'object',
        properties: { table: { type: 'string' }, recordId: { type: 'string' } },
        required: ['table', 'recordId'],
      },
      request: { method: 'GET', path: '/tables/{table}/records/{recordId}' },
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a new record.',
      parameters: {
        type: 'object',
        properties: { table: { type: 'string' }, data: { type: 'object' } },
        required: ['table', 'data'],
      },
      request: { method: 'POST', path: '/tables/{table}/records', body: '{data}' },
      cas: 'native-idempotency',
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update an existing record.',
      parameters: {
        type: 'object',
        properties: { table: { type: 'string' }, recordId: { type: 'string' }, data: { type: 'object' } },
        required: ['table', 'recordId', 'data'],
      },
      request: { method: 'PATCH', path: '/tables/{table}/records/{recordId}', body: '{data}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record.',
      parameters: {
        type: 'object',
        properties: { table: { type: 'string' }, recordId: { type: 'string' } },
        required: ['table', 'recordId'],
      },
      request: { method: 'DELETE', path: '/tables/{table}/records/{recordId}' },
    },
    {
      name: 'files.upload',
      class: 'mutation',
      description: 'Upload a file.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string' },
          recordId: { type: 'string' },
          field: { type: 'string' },
          file: { type: 'string' },
        },
        required: ['table', 'recordId', 'field', 'file'],
      },
      request: {
        method: 'POST',
        path: '/tables/{table}/records/{recordId}/files',
        body: { field: '{field}', file: '{file}' },
      },
    },
  ],
})
