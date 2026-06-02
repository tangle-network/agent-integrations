import { declarativeRestConnector } from './declarative-rest.js'

export const gristConnector = declarativeRestConnector({
  kind: 'grist',
  displayName: 'Grist',
  description: 'Create, update, and search records in Grist documents.',
  auth: {
    kind: 'api-key',
    hint: 'Grist API Key and Domain URL (e.g., https://example.grist.org)',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'domain' },
  test: { method: 'GET', path: '/api/docs' },
  capabilities: [
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a new record in a Grist table.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string', description: 'Document ID' },
          tableId: { type: 'string', description: 'Table ID' },
          record: { type: 'object', description: 'Record fields' },
        },
        required: ['docId', 'tableId', 'record'],
      },
      request: {
        method: 'POST',
        path: '/api/docs/{docId}/tables/{tableId}/records',
        body: { records: [{ fields: '{record}' }] },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update an existing record in a Grist table.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string', description: 'Document ID' },
          tableId: { type: 'string', description: 'Table ID' },
          recordId: { type: 'number', description: 'Record ID' },
          record: { type: 'object', description: 'Fields to update' },
        },
        required: ['docId', 'tableId', 'recordId', 'record'],
      },
      request: {
        method: 'PATCH',
        path: '/api/docs/{docId}/tables/{tableId}/records/{recordId}',
        body: { records: [{ id: '{recordId}', fields: '{record}' }] },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.search',
      class: 'read',
      description: 'Search for records matching a column value.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string', description: 'Document ID' },
          tableId: { type: 'string', description: 'Table ID' },
          column: { type: 'string', description: 'Column to search in' },
          value: { type: 'string', description: 'Search value (case-sensitive, exact match, Text columns only)' },
        },
        required: ['docId', 'tableId', 'column', 'value'],
      },
      request: {
        method: 'GET',
        path: '/api/docs/{docId}/tables/{tableId}/records',
        query: { filter: '{column} == "{value}"' },
      },
    },
    {
      name: 'records.add',
      class: 'mutation',
      description: 'Add one or more records to a Grist table.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string', description: 'Document ID' },
          tableId: { type: 'string', description: 'Table ID' },
          records: {
            type: 'array',
            description: 'Array of `{ fields: { ... } }` record entries to insert.',
            items: { type: 'object' },
          },
        },
        required: ['docId', 'tableId', 'records'],
      },
      request: {
        method: 'POST',
        path: '/api/docs/{docId}/tables/{tableId}/records',
        body: { records: '{records}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete one or more records by id from a Grist table.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string', description: 'Document ID' },
          tableId: { type: 'string', description: 'Table ID' },
          recordIds: {
            type: 'array',
            description: 'Array of numeric record ids to delete.',
            items: { type: 'number' },
          },
        },
        required: ['docId', 'tableId', 'recordIds'],
      },
      request: {
        method: 'POST',
        path: '/api/docs/{docId}/tables/{tableId}/data/delete',
        body: '{recordIds}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tables.create',
      class: 'mutation',
      description: 'Create one or more tables in a Grist document.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string', description: 'Document ID' },
          tableId: { type: 'string', description: 'Table ID (string identifier) for the new table.' },
          columns: {
            type: 'array',
            description: 'Column definitions, e.g. `[{ id: "Name", fields: { label: "Name", type: "Text" } }]`.',
            items: { type: 'object' },
          },
        },
        required: ['docId', 'tableId', 'columns'],
      },
      request: {
        method: 'POST',
        path: '/api/docs/{docId}/tables',
        body: { tables: [{ id: '{tableId}', columns: '{columns}' }] },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'attachments.upload',
      class: 'mutation',
      description: 'Upload attachments to a Grist record.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string', description: 'Document ID' },
          tableId: { type: 'string', description: 'Table ID' },
          recordId: { type: 'number', description: 'Record ID' },
          attachment: { type: 'string', description: 'Attachment file content (base64 or URL)' },
          attachmentName: {
            type: 'string',
            description: 'Custom name for the attachment (optional)',
          },
        },
        required: ['docId', 'tableId', 'recordId', 'attachment'],
      },
      request: {
        method: 'POST',
        path: '/api/docs/{docId}/tables/{tableId}/attachments',
        body: {
          records: [
            {
              recordId: '{recordId}',
              attachment: '{attachment}',
              attachmentName: '{attachmentName}',
            },
          ],
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
