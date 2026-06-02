import { declarativeRestConnector } from './declarative-rest.js'

export const clicdataConnector = declarativeRestConnector({
  kind: 'clicdata',
  displayName: 'ClicData',
  description:
    'Connect, transform, automate, visualize and share data from 300+ sources via the ClicData analytics platform.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.clicdata.com/oauth/authorize',
    tokenUrl: 'https://api.clicdata.com/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnv: 'CLICDATA_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CLICDATA_OAUTH_CLIENT_SECRET',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.clicdata.com',
  test: { method: 'GET', path: '/accounts/me' },
  capabilities: [
    {
      name: 'account.get',
      class: 'read',
      description: 'Get the authenticated ClicData account.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/accounts/me' },
    },
    {
      name: 'datasets.list',
      class: 'read',
      description: 'List ClicData datasets visible to the authenticated account.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          page_size: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/datasets',
        query: { page: '{page}', page_size: '{page_size}' },
      },
    },
    {
      name: 'datasets.get',
      class: 'read',
      description: 'Retrieve a single ClicData dataset by id.',
      parameters: {
        type: 'object',
        properties: { datasetId: { type: 'string' } },
        required: ['datasetId'],
      },
      request: { method: 'GET', path: '/datasets/{datasetId}' },
    },
    {
      name: 'datasets.rows',
      class: 'read',
      description: 'Read rows from a ClicData dataset.',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string' },
          page: { type: 'integer' },
          page_size: { type: 'integer' },
        },
        required: ['datasetId'],
      },
      request: {
        method: 'GET',
        path: '/datasets/{datasetId}/data',
        query: { page: '{page}', page_size: '{page_size}' },
      },
    },
    {
      name: 'dashboards.list',
      class: 'read',
      description: 'List ClicData dashboards in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          page_size: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/dashboards',
        query: { page: '{page}', page_size: '{page_size}' },
      },
    },
    {
      name: 'dashboards.get',
      class: 'read',
      description: 'Retrieve a single ClicData dashboard.',
      parameters: {
        type: 'object',
        properties: { dashboardId: { type: 'string' } },
        required: ['dashboardId'],
      },
      request: { method: 'GET', path: '/dashboards/{dashboardId}' },
    },
    {
      name: 'datasets.rows.append',
      class: 'mutation',
      description: 'Append rows to a ClicData dataset.',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string' },
          rows: { type: 'array' },
        },
        required: ['datasetId', 'rows'],
      },
      request: {
        method: 'POST',
        path: '/datasets/{datasetId}/data',
        body: { rows: '{rows}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'datasets.rows.replace',
      class: 'mutation',
      description: 'Replace all rows in a ClicData dataset.',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string' },
          rows: { type: 'array' },
        },
        required: ['datasetId', 'rows'],
      },
      request: {
        method: 'PUT',
        path: '/datasets/{datasetId}/data',
        body: { rows: '{rows}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'datasets.refresh',
      class: 'mutation',
      description: 'Trigger a refresh of a ClicData dataset against its source.',
      parameters: {
        type: 'object',
        properties: { datasetId: { type: 'string' } },
        required: ['datasetId'],
      },
      request: { method: 'POST', path: '/datasets/{datasetId}/refresh' },
      cas: 'native-idempotency',
    },
    {
      name: 'datasets.clear',
      class: 'mutation',
      description: 'Clear all rows from a ClicData dataset.',
      parameters: {
        type: 'object',
        properties: { datasetId: { type: 'string' } },
        required: ['datasetId'],
      },
      request: { method: 'DELETE', path: '/datasets/{datasetId}/data' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'datasets.create',
      class: 'mutation',
      description: 'Create a new ClicData dataset.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          category_id: { type: 'integer' },
          columns: { type: 'array' },
        },
        required: ['name', 'columns'],
      },
      request: {
        method: 'POST',
        path: '/datasets',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'datasets.delete',
      class: 'mutation',
      description: 'Delete a ClicData dataset by id.',
      parameters: {
        type: 'object',
        properties: { datasetId: { type: 'string' } },
        required: ['datasetId'],
      },
      request: { method: 'DELETE', path: '/datasets/{datasetId}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'dashboards.refresh',
      class: 'mutation',
      description: 'Trigger a refresh of all data backing a ClicData dashboard.',
      parameters: {
        type: 'object',
        properties: { dashboardId: { type: 'string' } },
        required: ['dashboardId'],
      },
      request: { method: 'POST', path: '/dashboards/{dashboardId}/refresh' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
