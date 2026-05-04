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
  ],
})
