import { declarativeRestConnector } from './declarative-rest.js'

export const reoonVerifierConnector = declarativeRestConnector({
  kind: 'reoon-verifier',
  displayName: 'Reoon Verifier',
  description: 'Email validation service that cleans invalid, temporary, and unsafe email addresses.',
  auth: { kind: 'api-key', hint: 'Reoon API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.reoon.com',
  test: { method: 'GET', path: '/api/v1/verify' },
  capabilities: [
    {
      name: 'verify.email',
      class: 'read',
      description: 'Verify a single email address.',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
      request: { method: 'GET', path: '/api/v1/verify', query: { email: '{email}' } },
    },
    {
      name: 'bulk.email.verification',
      class: 'mutation',
      description: 'Start a bulk email verification task.',
      parameters: {
        type: 'object',
        properties: {
          taskName: { type: 'string' },
          emails: { type: 'array', items: { type: 'string' } },
        },
        required: ['taskName', 'emails'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/bulk-verify/start',
        body: { taskName: '{taskName}', emails: '{emails}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'bulk.verification.result',
      class: 'read',
      description: 'Get results from a bulk verification task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/bulk-verify/result/{taskId}',
      },
    },
  ],
})
