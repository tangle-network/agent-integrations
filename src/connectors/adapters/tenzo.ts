import { declarativeRestConnector } from './declarative-rest.js'

export const tenzoConnector = declarativeRestConnector({
  kind: 'tenzo',
  displayName: 'Tenzo',
  description: 'Extract data and insights from the Tenzo platform for sales, forecasting, and analytics.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.tenzo.com/oauth/authorize',
    tokenUrl: 'https://api.tenzo.com/oauth/token',
    scopes: ['data:read'],
    clientIdEnv: 'TENZO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'TENZO_OAUTH_CLIENT_SECRET',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.tenzo.com/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'forecasts.list',
      class: 'read',
      description: 'Retrieve daily forecasts from Tenzo.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Number of forecasts to retrieve' },
          offset: { type: 'integer', description: 'Pagination offset' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/forecasts', query: { limit: '{limit}', offset: '{offset}' } },
      requiredScopes: ['data:read'],
    },
    {
      name: 'sales.summary',
      class: 'read',
      description: 'Get sales summary data from Tenzo.',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          limit: { type: 'integer', description: 'Maximum records to return' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/sales/summary', query: { startDate: '{startDate}', endDate: '{endDate}', limit: '{limit}' } },
      requiredScopes: ['data:read'],
    },
    {
      name: 'payments.summary',
      class: 'read',
      description: 'Retrieve payment summary data from Tenzo.',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          limit: { type: 'integer', description: 'Maximum records to return' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/payments/summary', query: { startDate: '{startDate}', endDate: '{endDate}', limit: '{limit}' } },
      requiredScopes: ['data:read'],
    },
    {
      name: 'insights.list',
      class: 'read',
      description: 'Fetch analytics and insights from Tenzo.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Insight category (sales, revenue, forecast, etc.)' },
          limit: { type: 'integer', description: 'Number of insights to retrieve' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/insights', query: { category: '{category}', limit: '{limit}' } },
      requiredScopes: ['data:read'],
    },
  ],
})
