import { declarativeRestConnector } from './declarative-rest.js'

export const wufooConnector = declarativeRestConnector({
  kind: 'wufoo',
  displayName: 'Wufoo',
  description: 'Query form entries, create submissions, and manage Wufoo forms.',
  auth: { kind: 'api-key', hint: 'Wufoo API key and subdomain.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://{subdomain}.wufoo.com/api/v3',
  test: { method: 'GET', path: '/forms.json' },
  capabilities: [
    {
      name: 'forms.list',
      class: 'read',
      description: 'List all forms in the Wufoo account.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/forms.json' },
    },
    {
      name: 'forms.find',
      class: 'read',
      description: 'Find a specific form by name or criteria.',
      parameters: {
        type: 'object',
        properties: { formHash: { type: 'string' } },
        required: ['formHash'],
      },
      request: { method: 'GET', path: '/forms/{formHash}.json' },
    },
    {
      name: 'entries.list',
      class: 'read',
      description: 'List entries from a specific form.',
      parameters: {
        type: 'object',
        properties: {
          formHash: { type: 'string' },
          pageStart: { type: 'integer' },
          pageSize: { type: 'integer' },
          sort: { type: 'string' },
        },
        required: ['formHash'],
      },
      request: {
        method: 'GET',
        path: '/forms/{formHash}/entries.json',
        query: { pageStart: '{pageStart}', pageSize: '{pageSize}', sort: '{sort}' },
      },
    },
    {
      name: 'entries.get',
      class: 'read',
      description: 'Get a specific entry by ID.',
      parameters: {
        type: 'object',
        properties: { formHash: { type: 'string' }, entryId: { type: 'string' } },
        required: ['formHash', 'entryId'],
      },
      request: { method: 'GET', path: '/forms/{formHash}/entries/{entryId}.json' },
    },
    {
      name: 'entries.create',
      class: 'mutation',
      description: 'Create a new form entry.',
      parameters: {
        type: 'object',
        properties: { formHash: { type: 'string' }, data: { type: 'object' } },
        required: ['formHash', 'data'],
      },
      request: { method: 'POST', path: '/forms/{formHash}/entries.json', body: '{data}' },
      cas: 'native-idempotency',
    },
    {
      name: 'entries.search',
      class: 'read',
      description: 'Search form entries by field value.',
      parameters: {
        type: 'object',
        properties: {
          formHash: { type: 'string' },
          fieldId: { type: 'string' },
          searchValue: { type: 'string' },
          matchType: { type: 'string' },
        },
        required: ['formHash', 'fieldId', 'searchValue'],
      },
      request: {
        method: 'GET',
        path: '/forms/{formHash}/entries.json',
        query: { Field: '{fieldId}', Match: '{matchType}', Value: '{searchValue}' },
      },
    },
    {
      name: 'fields.list',
      class: 'read',
      description: 'List all fields in a form.',
      parameters: {
        type: 'object',
        properties: { formHash: { type: 'string' } },
        required: ['formHash'],
      },
      request: { method: 'GET', path: '/forms/{formHash}/fields.json' },
    },
    {
      name: 'entries.update',
      class: 'mutation',
      description: 'Update an existing entry.',
      parameters: {
        type: 'object',
        properties: {
          formHash: { type: 'string' },
          entryId: { type: 'string' },
          data: { type: 'object', description: 'Field-id keyed update payload.' },
        },
        required: ['formHash', 'entryId', 'data'],
      },
      request: {
        method: 'PUT',
        path: '/forms/{formHash}/entries/{entryId}.json',
        body: '{data}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'entries.delete',
      class: 'mutation',
      description: 'Delete a form entry.',
      parameters: {
        type: 'object',
        properties: {
          formHash: { type: 'string' },
          entryId: { type: 'string' },
        },
        required: ['formHash', 'entryId'],
      },
      request: {
        method: 'DELETE',
        path: '/forms/{formHash}/entries/{entryId}.json',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'webhooks.create',
      class: 'mutation',
      description: 'Subscribe a webhook to a form.',
      parameters: {
        type: 'object',
        properties: {
          formHash: { type: 'string' },
          url: { type: 'string', description: 'Webhook target URL.' },
          handshakeKey: { type: 'string', description: 'Optional shared secret echoed in posts.' },
          metadata: { type: 'boolean', description: 'Include field metadata in payload.' },
        },
        required: ['formHash', 'url'],
      },
      request: {
        method: 'PUT',
        path: '/forms/{formHash}/webhooks.json',
        body: { url: '{url}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'webhooks.delete',
      class: 'mutation',
      description: 'Unsubscribe a webhook from a form.',
      parameters: {
        type: 'object',
        properties: {
          formHash: { type: 'string' },
          webhookHash: { type: 'string' },
        },
        required: ['formHash', 'webhookHash'],
      },
      request: {
        method: 'DELETE',
        path: '/forms/{formHash}/webhooks/{webhookHash}.json',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
