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
    {
      name: 'tables.list',
      class: 'read',
      description: 'List tables in a NocoDB base/project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'The base/project ID to list tables for.' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/db/meta/projects/{projectId}/tables',
      },
    },
    {
      name: 'tables.create',
      class: 'mutation',
      description:
        'Create a new table inside a NocoDB base/project. `definition` carries the table schema (table_name, title, columns).',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'The base/project ID to create the table in.' },
          definition: {
            type: 'object',
            description: 'Table definition (table_name, title, columns, etc.).',
          },
        },
        required: ['projectId', 'definition'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/db/meta/projects/{projectId}/tables',
        body: '{definition}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'fields.create',
      class: 'mutation',
      description:
        'Add a column/field to an existing NocoDB table. `column` describes the new field (column_name, title, uidt, etc.).',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The table ID to add the column to.' },
          column: {
            type: 'object',
            description: 'Column definition (column_name, title, uidt, etc.).',
          },
        },
        required: ['tableId', 'column'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/db/meta/tables/{tableId}/columns',
        body: '{column}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'records.bulk-create',
      class: 'mutation',
      description:
        'Insert many records into a NocoDB table in one request. `records` is an array of field-value objects.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'The table ID to insert into.' },
          records: {
            type: 'array',
            description: 'Array of record objects to insert.',
            items: { type: 'object' },
          },
        },
        required: ['tableId', 'records'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/db/data/bulk/noco/{tableId}',
        body: '{records}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
