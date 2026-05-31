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
