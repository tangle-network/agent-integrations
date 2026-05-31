import { declarativeRestConnector } from './declarative-rest.js'

export const signNowConnector = declarativeRestConnector({
  kind: 'sign-now',
  displayName: 'SignNow',
  description: 'Upload documents, send invites for signing, and track document status.',
  auth: { kind: 'api-key', hint: 'SignNow OAuth2 access token.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.signnow.com/v2',
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'documents.upload',
      class: 'mutation',
      description: 'Upload a document to SignNow.',
      parameters: {
        type: 'object',
        properties: { filename: { type: 'string' }, filePath: { type: 'string' } },
        required: ['filename', 'filePath'],
      },
      request: { method: 'POST', path: '/documents', body: { filename: '{filename}', file: '{filePath}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.get',
      class: 'read',
      description: 'Retrieve document details and status.',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string' } },
        required: ['documentId'],
      },
      request: { method: 'GET', path: '/documents/{documentId}' },
    },
    {
      name: 'invites.send',
      class: 'mutation',
      description: 'Send a signing invite to a recipient for a document.',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string' }, to: { type: 'string' }, signingOrder: { type: 'integer' } },
        required: ['documentId', 'to'],
      },
      request: {
        method: 'POST',
        path: '/documents/{documentId}/invites',
        body: { to: '{to}', signingOrder: '{signingOrder}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'invites.cancel',
      class: 'mutation',
      description: 'Cancel a signing invite.',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string' }, inviteId: { type: 'string' } },
        required: ['documentId', 'inviteId'],
      },
      request: { method: 'DELETE', path: '/documents/{documentId}/invites/{inviteId}' },
      cas: 'etag-if-match',
    },
    {
      name: 'templates.get',
      class: 'read',
      description: 'List or retrieve document templates.',
      parameters: {
        type: 'object',
        properties: { templateId: { type: 'string' } },
        required: [],
      },
      request: { method: 'GET', path: '/templates/{templateId}' },
    },
    {
      name: 'templates.createDocumentFromTemplate',
      class: 'mutation',
      description: 'Create a document from a template.',
      parameters: {
        type: 'object',
        properties: { templateId: { type: 'string' }, documentName: { type: 'string' } },
        required: ['templateId', 'documentName'],
      },
      request: {
        method: 'POST',
        path: '/templates/{templateId}/copy',
        body: { name: '{documentName}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
