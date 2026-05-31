import { declarativeRestConnector } from './declarative-rest.js'

export const pocketbaseConnector = declarativeRestConnector({
  kind: 'pocketbase',
  displayName: 'PocketBase',
  description: 'Create, read, update, and delete records in a PocketBase collection.',
  auth: { kind: 'api-key', hint: 'PocketBase host URL, superuser email, and password.' },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'host' },
  test: { method: 'GET', path: '/api/health' },
  capabilities: [
    {
      name: 'records.list',
      class: 'read',
      description: 'Get a paginated list of records from a collection.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          page: { type: 'integer', description: 'Page number (default: 1)' },
          perPage: { type: 'integer', description: 'Records per page (default: 30)' },
          sort: { type: 'string', description: 'Order attribute(s). Use - for DESC, + for ASC.' },
          filter: { type: 'string', description: 'Filter expression' },
          expand: { type: 'string', description: 'Auto expand relations' },
          fields: { type: 'string', description: 'Comma separated fields to return' },
          skipTotal: { type: 'boolean', description: 'Skip total counts query' },
        },
        required: ['collection'],
      },
      request: {
        method: 'GET',
        path: '/api/collections/{collection}/records',
        query: {
          page: '{page}',
          perPage: '{perPage}',
          sort: '{sort}',
          filter: '{filter}',
          expand: '{expand}',
          fields: '{fields}',
          skipTotal: '{skipTotal}',
        },
      },
    },
    {
      name: 'records.fullList',
      class: 'read',
      description: 'Get all records from a collection.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          sort: { type: 'string', description: 'Order attribute(s)' },
          filter: { type: 'string', description: 'Filter expression' },
          expand: { type: 'string', description: 'Auto expand relations' },
          fields: { type: 'string', description: 'Comma separated fields to return' },
        },
        required: ['collection'],
      },
      request: {
        method: 'GET',
        path: '/api/collections/{collection}/records',
        query: {
          skipTotal: 'true',
          batch: '1000',
          sort: '{sort}',
          filter: '{filter}',
          expand: '{expand}',
          fields: '{fields}',
        },
      },
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Get a single record by ID.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          recordId: { type: 'string', description: 'Record ID' },
          expand: { type: 'string', description: 'Auto expand relations' },
          fields: { type: 'string', description: 'Comma separated fields to return' },
        },
        required: ['collection', 'recordId'],
      },
      request: {
        method: 'GET',
        path: '/api/collections/{collection}/records/{recordId}',
        query: {
          expand: '{expand}',
          fields: '{fields}',
        },
      },
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a new record in a collection.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          recordData: { type: 'object', description: 'Record data fields' },
          expand: { type: 'string', description: 'Auto expand relations' },
          fields: { type: 'string', description: 'Comma separated fields to return' },
        },
        required: ['collection', 'recordData'],
      },
      request: {
        method: 'POST',
        path: '/api/collections/{collection}/records',
        body: '{recordData}',
        query: {
          expand: '{expand}',
          fields: '{fields}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update an existing record.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          recordId: { type: 'string', description: 'Record ID' },
          recordData: { type: 'object', description: 'Record data fields to update' },
          expand: { type: 'string', description: 'Auto expand relations' },
          fields: { type: 'string', description: 'Comma separated fields to return' },
        },
        required: ['collection', 'recordId', 'recordData'],
      },
      request: {
        method: 'PATCH',
        path: '/api/collections/{collection}/records/{recordId}',
        body: '{recordData}',
        query: {
          expand: '{expand}',
          fields: '{fields}',
        },
      },
      cas: 'etag-if-match',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          recordId: { type: 'string', description: 'Record ID' },
        },
        required: ['collection', 'recordId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/collections/{collection}/records/{recordId}',
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
