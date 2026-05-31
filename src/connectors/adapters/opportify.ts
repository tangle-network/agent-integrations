import { declarativeRestConnector } from './declarative-rest.js'

export const opportifyConnector = declarativeRestConnector({
  kind: 'opportify',
  displayName: 'Opportify',
  description: 'Analyze emails and IP addresses with Opportify.',
  auth: { kind: 'api-key', hint: 'Opportify API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.opportify.com',
  test: { method: 'GET', path: '/status' },
  capabilities: [
    {
      name: 'analyze.email',
      class: 'read',
      description: 'Analyze an email address.',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
      request: { method: 'POST', path: '/analyze/email', body: { email: '{email}' } },
    },
    {
      name: 'analyze.ip.address',
      class: 'read',
      description: 'Analyze an IP address.',
      parameters: {
        type: 'object',
        properties: { ip: { type: 'string' } },
        required: ['ip'],
      },
      request: { method: 'POST', path: '/analyze/ip', body: { ip: '{ip}' } },
    },
  ],
})
