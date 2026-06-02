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
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a Salesforce sObject record by id.',
      parameters: {
        type: 'object',
        properties: { objectName: { type: 'string' }, recordId: { type: 'string' } },
        required: ['objectName', 'recordId'],
      },
      request: { method: 'DELETE', path: '/services/data/v61.0/sobjects/{objectName}/{recordId}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['api'],
    },
    {
      name: 'records.upsert',
      class: 'mutation',
      description:
        'Upsert a Salesforce sObject record using an external id field. The caller passes the external id field name and the external id value; the body is the record fields.',
      parameters: {
        type: 'object',
        properties: {
          objectName: { type: 'string' },
          externalIdField: { type: 'string', description: 'API name of the external-id field (e.g. ExternalId__c).' },
          externalId: { type: 'string', description: 'External id value used to match an existing record.' },
          fields: { type: 'object', description: 'Record fields to set on insert/update.' },
        },
        required: ['objectName', 'externalIdField', 'externalId', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/services/data/v61.0/sobjects/{objectName}/{externalIdField}/{externalId}',
        body: '{fields}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['api'],
    },
    {
      name: 'records.composite',
      class: 'mutation',
      description:
        'Execute a Salesforce composite request (multiple subrequests in one transaction). The caller passes the full composite envelope `{ allOrNone, compositeRequest: [...] }`.',
      parameters: {
        type: 'object',
        properties: {
          allOrNone: { type: 'boolean', description: 'Roll back all subrequests on any failure when true.' },
          compositeRequest: {
            type: 'array',
            description: 'Ordered list of Salesforce composite subrequests.',
            items: { type: 'object', additionalProperties: true },
          },
        },
        required: ['compositeRequest'],
      },
      request: {
        method: 'POST',
        path: '/services/data/v61.0/composite',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['api'],
    },
    {
      name: 'files.upload',
      class: 'mutation',
      description:
        'Upload a ContentVersion file. `fields` is the Salesforce ContentVersion record body using PascalCase field names — `Title`, `PathOnClient`, `VersionData` (base64), and optionally `FirstPublishLocationId` to attach the resulting ContentDocument to a record.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'object',
            description:
              'ContentVersion record fields. Required: Title, PathOnClient, VersionData (base64). Optional: FirstPublishLocationId.',
            additionalProperties: true,
          },
        },
        required: ['fields'],
      },
      request: {
        method: 'POST',
        path: '/services/data/v61.0/sobjects/ContentVersion',
        body: '{fields}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['api'],
    },
  ],
})
