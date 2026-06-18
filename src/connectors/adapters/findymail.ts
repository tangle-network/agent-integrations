import { declarativeRestConnector } from './declarative-rest.js'

// Findymail — Find verified work email addresses by name and company domain, verify deliverability, and discover emails across a domain.
// Auth: api-key. Base: https://app.findymail.com. Docs: https://www.findymail.com/api/
export const findymailConnector = declarativeRestConnector({
  kind: 'findymail',
  displayName: 'Findymail',
  description: 'Find verified work email addresses by name and company domain, verify deliverability, and discover emails across a domain.',
  auth: {
    kind: 'api-key',
    hint: 'API key from your Findymail dashboard. Sent as the Authorization: Bearer header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.findymail.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json', accept: 'application/json' },
  test: { method: 'GET', path: '/api/credits' },
  capabilities: [
    {
      name: 'email.find',
      class: 'mutation',
      description: 'Find a person\'s verified work email from their full name and company domain. Consumes a credit when an email is found.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full name of the person.' },
          domain: { type: 'string', description: 'Company domain.' },
        },
        required: ['name', 'domain'],
      },
      request: {
        method: 'POST',
        path: '/api/search/name',
        body: { name: '{name}', domain: '{domain}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'email.verify',
      class: 'mutation',
      description: 'Verify the deliverability of an email address and return the email provider. Consumes a verification credit.',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
      request: { method: 'POST', path: '/api/verify', body: { email: '{email}' } },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'email.find_by_domain',
      class: 'mutation',
      description: 'Find email addresses associated with a company domain. Consumes credits per email returned.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'Company domain to search.' } },
        required: ['domain'],
      },
      request: { method: 'POST', path: '/api/search/domain', body: { domain: '{domain}' } },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'credits.get',
      class: 'read',
      description: 'Retrieve the remaining credit balance for the account.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/api/credits' },
    },
  ],
})
