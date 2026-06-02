import { declarativeRestConnector } from './declarative-rest.js'

const baseTableParams = {
  type: 'object',
  properties: {
    baseId: { type: 'string' },
    tableName: { type: 'string' },
  },
  required: ['baseId', 'tableName'],
}

export const airtableConnector = declarativeRestConnector({
  kind: 'airtable',
  displayName: 'Airtable',
  description: 'Query and update Airtable records for lightweight operational databases.',
  auth: { kind: 'api-key', hint: 'Airtable personal access token.' },
  category: 'spreadsheet',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.airtable.com',
  test: { method: 'GET', path: '/v0/meta/whoami' },
  capabilities: [
    {
      name: 'records.list',
      class: 'read',
      description: 'List records in a table.',
      parameters: {
        ...baseTableParams,
        properties: {
          ...baseTableParams.properties,
          maxRecords: { type: 'integer', minimum: 1, maximum: 100 },
          filterByFormula: { type: 'string' },
        },
      },
      request: { method: 'GET', path: '/v0/{baseId}/{tableName}', query: { maxRecords: '{maxRecords}', filterByFormula: '{filterByFormula}' } },
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Read a single Airtable record.',
      parameters: {
        type: 'object',
        properties: { baseId: { type: 'string' }, tableName: { type: 'string' }, recordId: { type: 'string' } },
        required: ['baseId', 'tableName', 'recordId'],
      },
      request: { method: 'GET', path: '/v0/{baseId}/{tableName}/{recordId}' },
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create an Airtable record.',
      parameters: {
        type: 'object',
        properties: { baseId: { type: 'string' }, tableName: { type: 'string' }, fields: { type: 'object' } },
        required: ['baseId', 'tableName', 'fields'],
      },
      request: { method: 'POST', path: '/v0/{baseId}/{tableName}', body: { fields: '{fields}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update an Airtable record.',
      parameters: {
        type: 'object',
        properties: { baseId: { type: 'string' }, tableName: { type: 'string' }, recordId: { type: 'string' }, fields: { type: 'object' } },
        required: ['baseId', 'tableName', 'recordId', 'fields'],
      },
      request: { method: 'PATCH', path: '/v0/{baseId}/{tableName}/{recordId}', body: { fields: '{fields}' } },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record from a table.',
      parameters: {
        type: 'object',
        properties: { baseId: { type: 'string' }, tableName: { type: 'string' }, recordId: { type: 'string' } },
        required: ['baseId', 'tableName', 'recordId'],
      },
      request: { method: 'DELETE', path: '/v0/{baseId}/{tableName}/{recordId}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'records.upsert',
      class: 'mutation',
      description:
        'Insert or update records keyed by a merge field. Airtable performsUpsert mode keyed on fieldsToMergeOn.',
      parameters: {
        type: 'object',
        properties: {
          baseId: { type: 'string' },
          tableName: { type: 'string' },
          records: {
            type: 'array',
            description: 'List of { fields: { ... } } objects (max 10 per call).',
            items: { type: 'object' },
          },
          fieldsToMergeOn: {
            type: 'array',
            description: 'Field names used to match existing records for upsert.',
            items: { type: 'string' },
          },
          typecast: { type: 'boolean' },
        },
        required: ['baseId', 'tableName', 'records', 'fieldsToMergeOn'],
      },
      request: {
        method: 'PATCH',
        path: '/v0/{baseId}/{tableName}',
        body: {
          records: '{records}',
          performUpsert: { fieldsToMergeOn: '{fieldsToMergeOn}' },
          typecast: '{typecast}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'records.batchCreate',
      class: 'mutation',
      description: 'Create up to 10 records in a single call.',
      parameters: {
        type: 'object',
        properties: {
          baseId: { type: 'string' },
          tableName: { type: 'string' },
          records: {
            type: 'array',
            description: 'List of { fields: { ... } } objects (max 10 per call).',
            items: { type: 'object' },
          },
          typecast: { type: 'boolean' },
        },
        required: ['baseId', 'tableName', 'records'],
      },
      request: {
        method: 'POST',
        path: '/v0/{baseId}/{tableName}',
        body: {
          records: '{records}',
          typecast: '{typecast}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
