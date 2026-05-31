import { declarativeRestConnector } from './declarative-rest.js'

export const validatedmailsConnector = declarativeRestConnector({
  kind: 'validatedmails',
  displayName: 'ValidatedMails',
  description: 'Validate email addresses in real time and retrieve status, score, and domain-level deliverability signals.',
  auth: {
    kind: 'api-key',
    hint: 'ValidatedMails API key.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.validatedmails.com',
  test: { method: 'POST', path: '/validate' },
  capabilities: [
    {
      name: 'email.validate',
      class: 'mutation',
      description: 'Validate an email address in real time and return status, score, and domain-level deliverability signals.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'The email address to validate.',
          },
          dnsTimeoutMs: {
            type: 'integer',
            description: 'DNS timeout in milliseconds. Value is clamped between 200 and 5000.',
          },
          mode: {
            type: 'string',
            description: 'HTTP method used for validation request.',
            enum: ['smtp', 'dns'],
          },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/validate',
        body: {
          email: '{email}',
          dnsTimeoutMs: '{dnsTimeoutMs}',
          mode: '{mode}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
