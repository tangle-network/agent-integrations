import { declarativeRestConnector } from './declarative-rest.js'

export const instaChartsConnector = declarativeRestConnector({
  kind: 'insta-charts',
  displayName: 'InstaCharts',
  description: 'Create and visualize charts using InstaCharts.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.instacharts.com/oauth/authorize',
    tokenUrl: 'https://app.instacharts.com/oauth/token',
    scopes: ['chart.create', 'chart.read'],
    clientIdEnv: 'INSTACHARTS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'INSTACHARTS_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.instacharts.com/v1',
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'chart.generate',
      class: 'mutation',
      description: 'Generate a chart image from data.',
      parameters: {
        type: 'object',
        properties: {
          chartType: { type: 'string', enum: ['line', 'bar', 'pie', 'area', 'scatter'] },
          title: { type: 'string' },
          data: { type: 'object' },
          options: { type: 'object' },
        },
        required: ['chartType', 'title', 'data'],
      },
      request: {
        method: 'POST',
        path: '/chart/generate',
        body: {
          chartType: '{chartType}',
          title: '{title}',
          data: '{data}',
          options: '{options}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['chart.create'],
    },
  ],
})
