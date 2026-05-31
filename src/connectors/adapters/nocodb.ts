import { declarativeRestConnector } from './declarative-rest.js'

export const nocodbConnector = declarativeRestConnector({
  kind: 'nocodb',
  displayName: 'NocoDB',
  description: 'Create, read, update, delete, and search records in NocoDB tables.',
  auth: { kind: 'api-key', hint: 'NocoDB API token.' },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl' },
  test: { method: 'GET', path: '/api/v1/db/meta/projects' },
  capabilities: [
    {
      name: 'records.search',
      class: 'read',
      description: 'Search records in a NocoDB table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The table ID to search in.' },
          whereCondition: { type: 'string', description: 'Filter condition for records.' },
          limit: { type: 'integer', description: 'Maximum number of records to return.' },
          sort: { type: 'string', description: 'Comma-separated field names for sorting.' },
        },
        required: ['tableId', 'limit'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/db/data/noco/{tableId}',
        query: {
          where: '{whereCondition}',
          limit: '{limit}',
          sort: '{sort}',
        },
      },
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Retrieve a single record from a NocoDB table by record ID.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The table ID.' },
          recordId: { type: 'string', description: 'The unique record ID.' },
        },
        required: ['tableId', 'recordId'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/db/data/noco/{tableId}/{recordId}',
      },
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a new record in a NocoDB table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The table ID.' },
          fields: { type: 'object', description: 'Field values for the new record.' },
        },
        required: ['tableId', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/db/data/noco/{tableId}',
        body: '{fields}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update an existing record in a NocoDB table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The table ID.' },
          recordId: { type: 'string', description: 'The unique record ID to update.' },
          fields: { type: 'object', description: 'Fields to update.' },
        },
        required: ['tableId', 'recordId', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/api/v1/db/data/noco/{tableId}/{recordId}',
        body: '{fields}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record from a NocoDB table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The table ID.' },
          recordId: { type: 'string', description: 'The unique record ID to delete.' },
        },
        required: ['tableId', 'recordId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/v1/db/data/noco/{tableId}/{recordId}',
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
