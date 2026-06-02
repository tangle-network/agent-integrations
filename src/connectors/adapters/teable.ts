import { declarativeRestConnector } from './declarative-rest.js'

export const teableConnector = declarativeRestConnector({
  kind: 'teable',
  displayName: 'Teable',
  description: 'Create, read, update, and delete records in Teable databases, plus upload attachments.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.teable.io/oauth/authorize',
    tokenUrl: 'https://app.teable.io/oauth/token',
    scopes: ['database:read', 'database:write'],
    clientIdEnv: 'TEABLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'TEABLE_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.teable.io/api/v1',
  test: { method: 'GET', path: '/bases' },
  capabilities: [
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a new record in a Teable table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['tableId', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/tables/{tableId}/records',
        body: { fields: '{fields}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'records.find',
      class: 'read',
      description: 'Find records in a Teable table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          filter: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['tableId'],
      },
      request: {
        method: 'GET',
        path: '/tables/{tableId}/records',
        query: {
          filter: '{filter}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Get a single record by ID from a Teable table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          recordId: { type: 'string' },
        },
        required: ['tableId', 'recordId'],
      },
      request: {
        method: 'GET',
        path: '/tables/{tableId}/records/{recordId}',
      },
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update an existing record in a Teable table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          recordId: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['tableId', 'recordId', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/tables/{tableId}/records/{recordId}',
        body: { fields: '{fields}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record from a Teable table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          recordId: { type: 'string' },
        },
        required: ['tableId', 'recordId'],
      },
      request: {
        method: 'DELETE',
        path: '/tables/{tableId}/records/{recordId}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'attachments.upload',
      class: 'mutation',
      description: 'Upload an attachment to a Teable record field.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          recordId: { type: 'string' },
          fieldId: { type: 'string' },
          fileUrl: { type: 'string' },
          fileName: { type: 'string' },
        },
        required: ['tableId', 'recordId', 'fieldId', 'fileUrl'],
      },
      request: {
        method: 'POST',
        path: '/tables/{tableId}/records/{recordId}/attachments',
        body: {
          fieldId: '{fieldId}',
          fileUrl: '{fileUrl}',
          fileName: '{fileName}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tables.list',
      class: 'read',
      description: 'List all tables in a Teable base.',
      parameters: {
        type: 'object',
        properties: {
          baseId: { type: 'string', description: 'The ID of the base.' },
        },
        required: ['baseId'],
      },
      request: {
        method: 'GET',
        path: '/base/{baseId}/table',
      },
    },
    {
      name: 'tables.create',
      class: 'mutation',
      description: 'Create a new table in a Teable base.',
      parameters: {
        type: 'object',
        properties: {
          baseId: { type: 'string' },
          name: { type: 'string', description: 'Table name.' },
        },
        required: ['baseId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/base/{baseId}/table',
        body: {
          name: '{name}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'fields.create',
      class: 'mutation',
      description: 'Add a field (column) to a Teable table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          name: { type: 'string', description: 'Field name.' },
          type: { type: 'string', description: 'Field type (e.g. singleLineText, number, checkbox).' },
        },
        required: ['tableId', 'name', 'type'],
      },
      request: {
        method: 'POST',
        path: '/table/{tableId}/field',
        body: {
          name: '{name}',
          type: '{type}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'views.create',
      class: 'mutation',
      description: 'Create a new view on a Teable table.',
      parameters: {
        type: 'object',
        properties: {
          tableId: { type: 'string' },
          name: { type: 'string', description: 'View name.' },
          type: { type: 'string', description: 'View type (e.g. grid, kanban, gallery, form).' },
        },
        required: ['tableId', 'name', 'type'],
      },
      request: {
        method: 'POST',
        path: '/table/{tableId}/view',
        body: {
          name: '{name}',
          type: '{type}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
