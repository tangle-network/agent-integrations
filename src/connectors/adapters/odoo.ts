import { declarativeRestConnector } from './declarative-rest.js'

export const odooConnector = declarativeRestConnector({
  kind: 'odoo',
  displayName: 'Odoo',
  description: 'Search, create, and update records in Odoo.',
  auth: {
    kind: 'api-key',
    hint: 'Odoo API key. Also configure base URL, database name, and username at connection time.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'base_url' },
  test: { method: 'POST', path: '/api/v1/common/version' },
  capabilities: [
    {
      name: 'records.search_read',
      class: 'read',
      description: 'Search and read records from an Odoo model using domain filters.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model name (e.g., res.partner, sale.order)' },
          domain: {
            type: 'array',
            description: 'List of domain criteria. Each criterion is [field, operator, value].',
          },
          fields: { type: 'array', description: 'List of field names to return. If empty, returns all fields.' },
          limit: { type: 'integer', description: 'Maximum number of records to return.' },
          offset: { type: 'integer', description: 'Number of records to skip.' },
        },
        required: ['model'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/search_read',
        body: {
          model: '{model}',
          domain: '{domain}',
          fields: '{fields}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Read a single record by ID.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model name' },
          recordId: { type: 'integer', description: 'Record ID' },
          fields: { type: 'array', description: 'List of field names to return.' },
        },
        required: ['model', 'recordId'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/read',
        body: {
          model: '{model}',
          ids: ['{recordId}'],
          fields: '{fields}',
        },
      },
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a new record in an Odoo model.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model name' },
          values: { type: 'object', description: 'Field names and values for the new record' },
        },
        required: ['model', 'values'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/create',
        body: {
          model: '{model}',
          values: '{values}',
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
          model: { type: 'string', description: 'Model name' },
          recordId: { type: 'integer', description: 'Record ID' },
          values: { type: 'object', description: 'Field names and values to update' },
        },
        required: ['model', 'recordId', 'values'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/write',
        body: {
          model: '{model}',
          ids: ['{recordId}'],
          values: '{values}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model name' },
          recordId: { type: 'integer', description: 'Record ID' },
        },
        required: ['model', 'recordId'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/unlink',
        body: {
          model: '{model}',
          ids: ['{recordId}'],
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'models.search',
      class: 'read',
      description: 'Search for record IDs matching a domain filter.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model name' },
          domain: {
            type: 'array',
            description: 'List of domain criteria. Each criterion is [field, operator, value].',
          },
          limit: { type: 'integer', description: 'Maximum number of records to return.' },
          offset: { type: 'integer', description: 'Number of records to skip.' },
        },
        required: ['model'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/search',
        body: {
          model: '{model}',
          domain: '{domain}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'models.count',
      class: 'read',
      description: 'Count records matching a domain filter.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model name' },
          domain: {
            type: 'array',
            description: 'List of domain criteria. Each criterion is [field, operator, value].',
          },
        },
        required: ['model'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/search_count',
        body: {
          model: '{model}',
          domain: '{domain}',
        },
      },
    },
  ],
})
