import { declarativeRestConnector } from './declarative-rest.js'

export const salesforceConnector = declarativeRestConnector({
  kind: 'salesforce',
  displayName: 'Salesforce',
  description: 'Query Salesforce records with SOQL and create or update sObjects.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    scopes: ['api', 'refresh_token'],
    clientIdEnv: 'SALESFORCE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SALESFORCE_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instanceUrl' },
  test: { method: 'GET', path: '/services/data/v61.0/' },
  capabilities: [
    {
      name: 'records.query',
      class: 'read',
      description: 'Run a SOQL query.',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      request: { method: 'GET', path: '/services/data/v61.0/query', query: { q: '{q}' } },
      requiredScopes: ['api'],
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Read a Salesforce sObject record.',
      parameters: {
        type: 'object',
        properties: { objectName: { type: 'string' }, recordId: { type: 'string' } },
        required: ['objectName', 'recordId'],
      },
      request: { method: 'GET', path: '/services/data/v61.0/sobjects/{objectName}/{recordId}' },
      requiredScopes: ['api'],
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a Salesforce sObject record.',
      parameters: {
        type: 'object',
        properties: { objectName: { type: 'string' }, fields: { type: 'object' } },
        required: ['objectName', 'fields'],
      },
      request: { method: 'POST', path: '/services/data/v61.0/sobjects/{objectName}', body: '{fields}' },
      cas: 'native-idempotency',
      requiredScopes: ['api'],
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update a Salesforce sObject record.',
      parameters: {
        type: 'object',
        properties: { objectName: { type: 'string' }, recordId: { type: 'string' }, fields: { type: 'object' } },
        required: ['objectName', 'recordId', 'fields'],
      },
      request: { method: 'PATCH', path: '/services/data/v61.0/sobjects/{objectName}/{recordId}', body: '{fields}' },
      cas: 'etag-if-match',
      requiredScopes: ['api'],
    },
  ],
})
