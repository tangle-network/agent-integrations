import { declarativeRestConnector } from './declarative-rest.js'

// SignWell — Create and send documents for electronic signature, and list or retrieve documents.
// Auth: api-key. Base: https://www.signwell.com/api/v1. Docs: https://developers.signwell.com/reference/createdocument
export const signwellConnector = declarativeRestConnector({
  kind: 'signwell',
  displayName: 'SignWell',
  description: 'Create and send documents for electronic signature, and list or retrieve documents.',
  auth: {
    kind: 'api-key',
    hint: 'API key from Settings -> API (Create API Key). Sent in the X-Api-Key header.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://www.signwell.com/api/v1',
  credentialPlacement: { kind: 'header', header: 'X-Api-Key' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'documents.list',
      class: 'read',
      description: 'List documents in the account.',
      parameters: {
        type: 'object',
        properties: { page: { type: 'integer' }, limit: { type: 'integer' } },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/documents',
        query: { page: '{page}', limit: '{limit}' },
      },
    },
    {
      name: 'documents.get',
      class: 'read',
      description: 'Retrieve a single document by its id.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      request: { method: 'GET', path: '/documents/{id}' },
    },
    {
      name: 'account.get',
      class: 'read',
      description: 'Retrieve the account information associated with the API key.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/me' },
    },
    {
      name: 'documents.create',
      class: 'mutation',
      description: 'Create and optionally send a new document for signing. Set draft to true to create without sending.',
      parameters: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'object' } },
          recipients: { type: 'array', items: { type: 'object' } },
          name: { type: 'string' },
          subject: { type: 'string' },
          message: { type: 'string' },
          draft: { type: 'boolean' },
          test_mode: { type: 'boolean' },
          embedded_signing: { type: 'boolean' },
        },
        required: ['files', 'recipients'],
      },
      request: {
        method: 'POST',
        path: '/documents',
        body: {
          files: '{files}',
          recipients: '{recipients}',
          name: '{name}',
          subject: '{subject}',
          message: '{message}',
          draft: '{draft}',
          test_mode: '{test_mode}',
          embedded_signing: '{embedded_signing}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
