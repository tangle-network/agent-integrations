import { declarativeRestConnector } from './declarative-rest.js'

/** OneSpan Sign REST API. The customer connection supplies a pre-encoded
 * Basic credential and may override apiBaseUrl for its regional tenant. */
export const oneSpanSignConnector = declarativeRestConnector({
  kind: 'onespan-sign',
  displayName: 'OneSpan Sign',
  description:
    'Create, inspect, send, and delete OneSpan Sign packages, documents, and signer roles.',
  auth: {
    kind: 'api-key',
    hint: 'Base64-encoded OneSpan Sign API credential for HTTP Basic authentication.',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: {
    metadataKey: 'apiBaseUrl',
    fallback: 'https://sandbox.esignlive.com/api',
  },
  credentialPlacement: {
    kind: 'header',
    header: 'Authorization',
    prefix: 'Basic ',
  },
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'packages.list',
      class: 'read',
      description: 'List OneSpan signing packages with paging and status filters.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'integer', minimum: 0 },
          to: { type: 'integer', minimum: 1 },
          query: { type: 'string' },
          status: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/packages',
        query: { from: '{from}', to: '{to}', query: '{query}', status: '{status}' },
      },
    },
    {
      name: 'packages.get',
      class: 'read',
      description: 'Read a signing package, roles, documents, and status.',
      parameters: {
        type: 'object',
        properties: { packageId: { type: 'string' } },
        required: ['packageId'],
      },
      request: { method: 'GET', path: '/packages/{packageId}' },
    },
    {
      name: 'packages.create',
      class: 'mutation',
      description: 'Create a draft OneSpan signing package.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          emailMessage: { type: 'string' },
          roles: { type: 'array', items: { type: 'object' } },
          documents: { type: 'array', items: { type: 'object' } },
          settings: { type: 'object' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/packages', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'packages.send',
      class: 'mutation',
      description: 'Move a draft package to SENT and notify its signer roles.',
      parameters: {
        type: 'object',
        properties: { packageId: { type: 'string' } },
        required: ['packageId'],
      },
      request: {
        method: 'POST',
        path: '/packages/{packageId}',
        body: { status: 'SENT' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'packages.delete',
      class: 'mutation',
      description: 'Delete a OneSpan signing package.',
      parameters: {
        type: 'object',
        properties: { packageId: { type: 'string' } },
        required: ['packageId'],
      },
      request: { method: 'DELETE', path: '/packages/{packageId}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'documents.add',
      class: 'mutation',
      description: 'Add a document descriptor to a OneSpan package.',
      parameters: {
        type: 'object',
        properties: {
          packageId: { type: 'string' },
          document: { type: 'object' },
        },
        required: ['packageId', 'document'],
      },
      request: {
        method: 'POST',
        path: '/packages/{packageId}/documents',
        body: '{document}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'roles.add',
      class: 'mutation',
      description: 'Add a signer role to a OneSpan package.',
      parameters: {
        type: 'object',
        properties: {
          packageId: { type: 'string' },
          role: { type: 'object' },
        },
        required: ['packageId', 'role'],
      },
      request: {
        method: 'POST',
        path: '/packages/{packageId}/roles',
        body: '{role}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
