import { declarativeRestConnector } from './declarative-rest.js'

export const mailchainConnector = declarativeRestConnector({
  kind: 'mailchain',
  displayName: 'Mailchain',
  description: 'Send emails and retrieve authenticated user information via Mailchain.',
  auth: { kind: 'api-key', hint: 'Mailchain API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.mailchain.com',
  test: { method: 'GET', path: '/v1/user' },
  capabilities: [
    {
      name: 'user.get',
      class: 'read',
      description: 'Get authenticated user information.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/v1/user' },
    },
    {
      name: 'email.send',
      class: 'mutation',
      description: 'Send an email via Mailchain.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
      },
      request: {
        method: 'POST',
        path: '/v1/send',
        body: { to: '{to}', subject: '{subject}', body: '{body}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
