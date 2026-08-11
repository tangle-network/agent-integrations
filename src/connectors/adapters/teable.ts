import { declarativeRestConnector } from './declarative-rest.js'

export const teableConnector = declarativeRestConnector({
  kind: 'teable',
  displayName: 'Teable',
  description: 'Read and write records, tables, fields, and views in Teable databases.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.teable.ai/api/oauth/authorize',
    tokenUrl: 'https://app.teable.ai/api/oauth/access_token',
    scopes: [
      'base|read',
      'table|read',
      'table|create',
      'field|create',
      'view|create',
      'record|read',
      'record|create',
      'record|update',
    ],
    clientIdEnv: 'TEABLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'TEABLE_OAUTH_CLIENT_SECRET',
    pkce: 'supported',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.teable.ai/api',
  test: { method: 'GET', path: '/auth/user/me' },
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
          fieldKeyType: { type: 'string', enum: ['name', 'id', 'dbFieldName'] },
          typecast: { type: 'boolean' },
        },
        required: ['tableId', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/table/{tableId}/record',
        body: {
          records: [{ fields: '{fields}' }],
          fieldKeyType: '{fieldKeyType}',
          typecast: '{typecast}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['record|create'],
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
          take: { type: 'integer', minimum: 1, maximum: 1000 },
          skip: { type: 'integer', minimum: 0 },
          viewId: { type: 'string' },
          fieldKeyType: { type: 'string', enum: ['name', 'id', 'dbFieldName'] },
          cellFormat: { type: 'string', enum: ['json', 'text'] },
        },
        required: ['tableId'],
      },
      request: {
        method: 'GET',
        path: '/table/{tableId}/record',
        query: {
          filter: '{filter}',
          take: '{take}',
          skip: '{skip}',
          viewId: '{viewId}',
          fieldKeyType: '{fieldKeyType}',
          cellFormat: '{cellFormat}',
        },
      },
      requiredScopes: ['record|read'],
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
          fieldKeyType: { type: 'string', enum: ['name', 'id', 'dbFieldName'] },
          cellFormat: { type: 'string', enum: ['json', 'text'] },
        },
        required: ['tableId', 'recordId'],
      },
      request: {
        method: 'GET',
        path: '/table/{tableId}/record/{recordId}',
        query: {
          fieldKeyType: '{fieldKeyType}',
          cellFormat: '{cellFormat}',
        },
      },
      requiredScopes: ['record|read'],
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
          fieldKeyType: { type: 'string', enum: ['name', 'id', 'dbFieldName'] },
          typecast: { type: 'boolean' },
        },
        required: ['tableId', 'recordId', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/table/{tableId}/record/{recordId}',
        body: {
          record: { fields: '{fields}' },
          fieldKeyType: '{fieldKeyType}',
          typecast: '{typecast}',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['record|update'],
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
      requiredScopes: ['table|read'],
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
      requiredScopes: ['table|create'],
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
      requiredScopes: ['field|create'],
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
      requiredScopes: ['view|create'],
    },
  ],
})
