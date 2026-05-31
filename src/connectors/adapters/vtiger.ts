import { declarativeRestConnector } from './declarative-rest.js'

export const vtigerConnector = declarativeRestConnector({
  kind: 'vtiger',
  displayName: 'VTiger',
  description: 'Search, create, update, and delete records in VTiger CRM.',
  auth: {
    kind: 'api-key',
    hint: 'VTiger instance URL, username, and access key.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instance_url' },
  test: { method: 'GET', path: '/restapi/v1/vtiger/default' },
  capabilities: [
    {
      name: 'records.search',
      class: 'read',
      description: 'Search records in VTiger using filter criteria.',
      parameters: {
        type: 'object',
        properties: {
          fields: { type: 'object', description: 'Search filter fields' },
          limit: { type: 'integer', description: 'Maximum number of records to return' },
        },
        required: ['fields'],
      },
      request: {
        method: 'GET',
        path: '/restapi/v1/vtiger/default',
        query: {
          fields: '{fields}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Get a specific record from VTiger.',
      parameters: {
        type: 'object',
        properties: { recordId: { type: 'string', description: 'The record ID' } },
        required: ['recordId'],
      },
      request: {
        method: 'GET',
        path: '/restapi/v1/vtiger/default/records/{recordId}',
      },
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a new record in VTiger.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Record fields and values' },
        },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/restapi/v1/vtiger/default/records',
        body: '{data}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update an existing record in VTiger.',
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string', description: 'The record ID' },
          data: { type: 'object', description: 'Fields and values to update' },
        },
        required: ['recordId', 'data'],
      },
      request: {
        method: 'PUT',
        path: '/restapi/v1/vtiger/default/records/{recordId}',
        body: '{data}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record from VTiger.',
      parameters: {
        type: 'object',
        properties: { recordId: { type: 'string', description: 'The record ID' } },
        required: ['recordId'],
      },
      request: {
        method: 'DELETE',
        path: '/restapi/v1/vtiger/default/records/{recordId}',
      },
    },
    {
      name: 'records.query',
      class: 'read',
      description: 'Query records using VTiger query language.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'VTiger query statement' } },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/restapi/v1/vtiger/default',
        query: { query: '{query}' },
      },
    },
  ],
})
