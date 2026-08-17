import { declarativeRestConnector } from './declarative-rest.js'

const tableParameter = {
  tableId: { type: 'integer', description: 'Baserow table id.' },
}

const rowParameter = {
  rowId: { type: 'integer', description: 'Baserow row id.' },
}

const webhookQuery = {
  send_webhook_events: '{sendWebhookEvents}',
}

export const baserowConnector = declarativeRestConnector({
  kind: 'baserow',
  displayName: 'Baserow',
  description: 'List tables and fields, and create, read, update, move, or delete Baserow rows.',
  auth: {
    kind: 'api-key',
    hint: 'Baserow database token. Grant only the tables and create/read/update/delete permissions this connection needs.',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://api.baserow.io' },
  requirePublicHttpsBaseUrl: true,
  credentialPlacement: { kind: 'header', header: 'authorization', prefix: 'Token ' },
  test: { method: 'GET', path: '/api/database/tokens/check/' },
  capabilities: [
    {
      name: 'tables.list',
      class: 'read',
      description: 'List every table the database token can access and its granted permissions.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/api/database/tables/all-tables/' },
    },
    {
      name: 'fields.list',
      class: 'read',
      description: 'List field definitions for a table.',
      parameters: {
        type: 'object',
        properties: tableParameter,
        required: ['tableId'],
      },
      request: { method: 'GET', path: '/api/database/fields/table/{tableId}/' },
    },
    {
      name: 'fields.create',
      class: 'mutation',
      description: 'Create a field using a provider-native field definition.',
      parameters: {
        type: 'object',
        properties: {
          ...tableParameter,
          field: {
            type: 'object',
            description: 'Field definition containing at least name and type.',
          },
        },
        required: ['tableId', 'field'],
      },
      request: {
        method: 'POST',
        path: '/api/database/fields/table/{tableId}/',
        body: '{field}',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'rows.list',
      class: 'read',
      description: 'List, search, filter, and order rows using human-readable field names.',
      parameters: {
        type: 'object',
        properties: {
          ...tableParameter,
          page: { type: 'integer', minimum: 1 },
          size: { type: 'integer', minimum: 1, maximum: 200 },
          search: { type: 'string' },
          orderBy: { type: 'string', description: 'Comma-separated field names, prefixed with - for descending.' },
          filters: { type: 'string', description: 'JSON-serialized Baserow filter tree.' },
          filterType: { type: 'string', enum: ['AND', 'OR'] },
          include: { type: 'string', description: 'Comma-separated field names to include.' },
          exclude: { type: 'string', description: 'Comma-separated field names to exclude.' },
          viewId: { type: 'integer' },
        },
        required: ['tableId'],
      },
      request: {
        method: 'GET',
        path: '/api/database/rows/table/{tableId}/',
        query: {
          user_field_names: true,
          page: '{page}',
          size: '{size}',
          search: '{search}',
          order_by: '{orderBy}',
          filters: '{filters}',
          filter_type: '{filterType}',
          include: '{include}',
          exclude: '{exclude}',
          view_id: '{viewId}',
        },
      },
    },
    {
      name: 'rows.get',
      class: 'read',
      description: 'Read one row using human-readable field names.',
      parameters: {
        type: 'object',
        properties: { ...tableParameter, ...rowParameter },
        required: ['tableId', 'rowId'],
      },
      request: {
        method: 'GET',
        path: '/api/database/rows/table/{tableId}/{rowId}/',
        query: { user_field_names: true },
      },
    },
    {
      name: 'rows.create',
      class: 'mutation',
      description: 'Create one row using human-readable field names.',
      parameters: {
        type: 'object',
        properties: {
          ...tableParameter,
          fields: { type: 'object', description: 'Field-name to value map.' },
          beforeRowId: { type: 'integer' },
          sendWebhookEvents: { type: 'boolean' },
        },
        required: ['tableId', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/api/database/rows/table/{tableId}/',
        query: {
          user_field_names: true,
          before: '{beforeRowId}',
          ...webhookQuery,
        },
        body: '{fields}',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'rows.update',
      class: 'mutation',
      description: 'Update one row using human-readable field names.',
      parameters: {
        type: 'object',
        properties: {
          ...tableParameter,
          ...rowParameter,
          fields: { type: 'object', description: 'Field-name to value map.' },
          sendWebhookEvents: { type: 'boolean' },
        },
        required: ['tableId', 'rowId', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/api/database/rows/table/{tableId}/{rowId}/',
        query: { user_field_names: true, ...webhookQuery },
        body: '{fields}',
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'rows.delete',
      class: 'mutation',
      description: 'Delete one row.',
      parameters: {
        type: 'object',
        properties: {
          ...tableParameter,
          ...rowParameter,
          sendWebhookEvents: { type: 'boolean' },
        },
        required: ['tableId', 'rowId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/database/rows/table/{tableId}/{rowId}/',
        query: webhookQuery,
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'rows.batch-create',
      class: 'mutation',
      description: 'Create up to 200 rows in one request.',
      parameters: {
        type: 'object',
        properties: {
          ...tableParameter,
          items: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object' } },
          beforeRowId: { type: 'integer' },
          sendWebhookEvents: { type: 'boolean' },
        },
        required: ['tableId', 'items'],
      },
      request: {
        method: 'POST',
        path: '/api/database/rows/table/{tableId}/batch/',
        query: {
          user_field_names: true,
          before: '{beforeRowId}',
          ...webhookQuery,
        },
        body: { items: '{items}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'rows.batch-update',
      class: 'mutation',
      description: 'Update up to 200 rows; each item must include its id.',
      parameters: {
        type: 'object',
        properties: {
          ...tableParameter,
          items: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object' } },
          sendWebhookEvents: { type: 'boolean' },
        },
        required: ['tableId', 'items'],
      },
      request: {
        method: 'PATCH',
        path: '/api/database/rows/table/{tableId}/batch/',
        query: { user_field_names: true, ...webhookQuery },
        body: { items: '{items}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'rows.batch-delete',
      class: 'mutation',
      description: 'Delete multiple rows by id.',
      parameters: {
        type: 'object',
        properties: {
          ...tableParameter,
          rowIds: { type: 'array', minItems: 1, items: { type: 'integer' } },
          sendWebhookEvents: { type: 'boolean' },
        },
        required: ['tableId', 'rowIds'],
      },
      request: {
        method: 'POST',
        path: '/api/database/rows/table/{tableId}/batch-delete/',
        query: webhookQuery,
        body: { items: '{rowIds}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'rows.move',
      class: 'mutation',
      description: 'Move a row before another row, or to the end when beforeRowId is omitted.',
      parameters: {
        type: 'object',
        properties: {
          ...tableParameter,
          ...rowParameter,
          beforeRowId: { type: 'integer' },
          sendWebhookEvents: { type: 'boolean' },
        },
        required: ['tableId', 'rowId'],
      },
      request: {
        method: 'PATCH',
        path: '/api/database/rows/table/{tableId}/{rowId}/move/',
        query: { before_id: '{beforeRowId}', ...webhookQuery },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
  ],
})
