import { declarativeRestConnector } from './declarative-rest.js'

// Snov.io — Find and verify B2B email addresses by domain or by name, and enrich profiles from an email address.
// Auth: api-key. Base: https://api.snov.io. Docs: https://snov.io/api
export const snovIoConnector = declarativeRestConnector({
  kind: 'snov-io',
  displayName: 'Snov.io',
  description: 'Find and verify B2B email addresses by domain or by name, and enrich profiles from an email address.',
  auth: {
    kind: 'api-key',
    hint: 'Exchange your API User ID and Secret (account Settings -> API) for an access token via POST /v1/oauth/access_token, then paste the access token here. Sent as the Authorization: Bearer header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.snov.io',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/v2/sender-accounts/emails' },
  capabilities: [
    {
      name: 'domain_search.start',
      class: 'mutation',
      description: 'Start an asynchronous search for email addresses belonging to a company domain. Returns a task to poll for results.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'Company domain to search.' } },
        required: ['domain'],
      },
      request: {
        method: 'POST',
        path: '/v2/domain-search/start',
        body: { domain: '{domain}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'email_finder.start',
      class: 'mutation',
      description: 'Start finding email addresses for one or more people by first name, last name, and company domain. Returns a task to poll; consumes credits when emails are found.',
      parameters: {
        type: 'object',
        properties: {
          rows: {
            type: 'array',
            description: 'Array of objects each with first_name, last_name, and domain.',
            items: { type: 'object' },
          },
        },
        required: ['rows'],
      },
      request: {
        method: 'POST',
        path: '/v2/emails-by-domain-by-name/start',
        body: { rows: '{rows}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'email_verification.start',
      class: 'mutation',
      description: 'Start verification of up to 10 email addresses. Returns a task to poll for deliverability results. Consumes credits.',
      parameters: {
        type: 'object',
        properties: {
          emails: {
            type: 'array',
            description: 'Array of email addresses to verify (max 10).',
            items: { type: 'string' },
          },
        },
        required: ['emails'],
      },
      request: {
        method: 'POST',
        path: '/v2/email-verification/start',
        body: { emails: '{emails}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'profile.get_by_email',
      class: 'mutation',
      description: 'Enrich a social/professional profile from an email address. Consumes a credit.',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/v1/get-profile-by-email',
        body: { email: '{email}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'domain_emails_count.get',
      class: 'read',
      description: 'Get the count of email addresses available for a domain (free, does not consume credits).',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string' } },
        required: ['domain'],
      },
      request: {
        method: 'POST',
        path: '/v1/get-domain-emails-count',
        body: { domain: '{domain}' },
      },
    },
  ],
})
