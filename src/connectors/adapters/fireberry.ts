import { declarativeRestConnector } from './declarative-rest.js'

export const fireberryConnector = declarativeRestConnector({
  kind: 'fireberry',
  displayName: 'Fireberry',
  description: 'Create, update, find, and delete Fireberry CRM records via the Fireberry REST API.',
  auth: { kind: 'api-key', hint: 'Fireberry tokenid (sent as the tokenid request header).' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.fireberry.com',
  test: { method: 'GET', path: '/api/metadata/records/account' },
  capabilities: [
    {
      name: 'create.record',
      class: 'mutation',
      description: 'Create a record in the specified Fireberry object type.',
      parameters: {
        type: 'object',
        properties: {
          objectType: {
            type: 'string',
            description: 'System name of the Fireberry object (e.g. account, contact, case).',
          },
          data: {
            type: 'object',
            description: 'Field values keyed by Fireberry system field names.',
          },
        },
        required: ['objectType', 'data'],
      },
      request: {
        method: 'POST',
        path: '/api/record/{objectType}',
        body: { data: '{data}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'update.record',
      class: 'mutation',
      description: 'Update an existing record by id in the specified Fireberry object type.',
      parameters: {
        type: 'object',
        properties: {
          objectType: {
            type: 'string',
            description: 'System name of the Fireberry object (e.g. account, contact, case).',
          },
          recordId: {
            type: 'string',
            description: 'Fireberry record id (GUID) of the record to update.',
          },
          data: {
            type: 'object',
            description: 'Field values keyed by Fireberry system field names.',
          },
        },
        required: ['objectType', 'recordId', 'data'],
      },
      request: {
        method: 'PUT',
        path: '/api/record/{objectType}/{recordId}',
        body: { data: '{data}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'delete.record',
      class: 'mutation',
      description: 'Delete a record by id from the specified Fireberry object type. Destructive.',
      parameters: {
        type: 'object',
        properties: {
          objectType: {
            type: 'string',
            description: 'System name of the Fireberry object (e.g. account, contact, case).',
          },
          recordId: {
            type: 'string',
            description: 'Fireberry record id (GUID) of the record to delete.',
          },
        },
        required: ['objectType', 'recordId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/record/{objectType}/{recordId}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'find.record',
      class: 'read',
      description: 'Search Fireberry records using a query expression.',
      parameters: {
        type: 'object',
        properties: {
          objectType: {
            type: 'string',
            description: 'System name of the Fireberry object (e.g. account, contact, case).',
          },
          query: {
            type: 'string',
            description: 'Fireberry query expression (e.g. (firstname = \'John\')).',
          },
          fields: {
            type: 'string',
            description: 'Comma separated list of fields to return.',
          },
          sortBy: {
            type: 'string',
            description: 'System field name to sort results by.',
          },
          sortType: {
            type: 'string',
            description: 'Sort direction, asc or desc.',
          },
          pageSize: {
            type: 'integer',
            description: 'Number of records to return (max 50).',
          },
          pageNumber: {
            type: 'integer',
            description: 'Page number to retrieve (max 10).',
          },
        },
        required: ['objectType'],
      },
      request: {
        method: 'POST',
        path: '/api/query',
        body: {
          objecttype: '{objectType}',
          query: '{query}',
          fields: '{fields}',
          sort_by: '{sortBy}',
          sort_type: '{sortType}',
          page_size: '{pageSize}',
          page_number: '{pageNumber}',
        },
      },
    },
  ],
})
