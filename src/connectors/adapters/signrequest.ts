import { declarativeRestConnector } from './declarative-rest.js'

export const signrequestConnector = declarativeRestConnector({
  kind: 'signrequest',
  displayName: 'Signrequest',
  description: 'Send signature requests and manage signature workflows.',
  auth: { kind: 'api-key', hint: 'Signrequest API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://signrequest.com/api/v1',
  test: { method: 'GET', path: '/teams/' },
  capabilities: [
    {
      name: 'requests.send',
      class: 'mutation',
      description: 'Send a signature request.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the signature request' },
          subject: { type: 'string', description: 'Email subject line' },
          message: { type: 'string', description: 'Email message body' },
          signers: { type: 'object', description: 'Array of signer objects with email and name' },
          files: { type: 'object', description: 'Array of file objects to sign' },
        },
        required: ['title', 'signers', 'files'],
      },
      request: {
        method: 'POST',
        path: '/signrequests/',
        body: {
          title: '{title}',
          subject: '{subject}',
          message: '{message}',
          signers: '{signers}',
          files: '{files}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'requests.list',
      class: 'read',
      description: 'List signature requests.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status (draft, sent, viewed, signed, cancelled, completed)' },
          limit: { type: 'integer', description: 'Maximum number of results' },
          offset: { type: 'integer', description: 'Pagination offset' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/signrequests/',
        query: { status: '{status}', limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'requests.get',
      class: 'read',
      description: 'Get a signature request by ID.',
      parameters: {
        type: 'object',
        properties: { requestId: { type: 'string', description: 'The signature request ID' } },
        required: ['requestId'],
      },
      request: { method: 'GET', path: '/signrequests/{requestId}/' },
    },
    {
      name: 'requests.cancel',
      class: 'mutation',
      description: 'Cancel a signature request.',
      parameters: {
        type: 'object',
        properties: { requestId: { type: 'string', description: 'The signature request ID' } },
        required: ['requestId'],
      },
      request: {
        method: 'POST',
        path: '/signrequests/{requestId}/cancel_request/',
        body: {},
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'teams.get',
      class: 'read',
      description: 'Get current team information.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/teams/' },
    },
  ],
})
