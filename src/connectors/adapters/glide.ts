import { declarativeRestConnector } from './declarative-rest.js'

export const glideConnector = declarativeRestConnector({
  kind: 'glide',
  displayName: 'Glide',
  description: 'Manage Glide Big Tables and rows with Glide API.',
  auth: { kind: 'api-key', hint: 'Glide API key.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.glideapps.com/v1',
  test: { method: 'GET', path: '/tables' },
  capabilities: [
    {
      name: 'tables.list',
      class: 'read',
      description: 'List all Glide Big Tables.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/tables' },
    },
    {
      name: 'rows.get',
      class: 'read',
      description: 'Get rows from a Glide table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The Glide table ID.' },
          limit: { type: 'integer', description: 'Maximum number of rows to return.' },
        },
        required: ['tableId'],
      },
      request: { method: 'GET', path: '/tables/{tableId}/rows', query: { limit: '{limit}' } },
    },
    {
      name: 'rows.add',
      class: 'mutation',
      description: 'Add rows to a Glide table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The Glide table ID.' },
          rows: { type: 'array', description: 'Array of JSON objects matching the table columns.' },
        },
        required: ['tableId', 'rows'],
      },
      request: { method: 'POST', path: '/tables/{tableId}/rows', body: { rows: '{rows}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'rows.update',
      class: 'mutation',
      description: 'Update a row in a Glide table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The Glide table ID.' },
          rowId: { type: 'string', description: 'The Glide row ID to update.' },
          row: { type: 'object', description: 'JSON object containing columns to update.' },
        },
        required: ['tableId', 'rowId', 'row'],
      },
      request: { method: 'PATCH', path: '/tables/{tableId}/rows/{rowId}', body: '{row}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'rows.delete',
      class: 'mutation',
      description: 'Delete a row from a Glide table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The Glide table ID.' },
          rowId: { type: 'string', description: 'The Glide row ID to delete.' },
        },
        required: ['tableId', 'rowId'],
      },
      request: { method: 'DELETE', path: '/tables/{tableId}/rows/{rowId}' },
      cas: 'optimistic-read-verify',
    },
  ],
})
