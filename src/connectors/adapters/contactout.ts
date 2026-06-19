import { declarativeRestConnector } from './declarative-rest.js'

// ContactOut — Find and enrich professional and personal emails, phone numbers, and LinkedIn data for prospects.
// Auth: api-key. Base: https://api.contactout.com. Docs: https://api.contactout.com/
export const contactoutConnector = declarativeRestConnector({
  kind: 'contactout',
  displayName: 'ContactOut',
  description: 'Find and enrich professional and personal emails, phone numbers, and LinkedIn data for prospects.',
  auth: {
    kind: 'api-key',
    hint: 'API token from your ContactOut account. Sent as the \'token\' header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.contactout.com',
  credentialPlacement: { kind: 'header', header: 'token' },
  defaultHeaders: { 'content-type': 'application/json' },
  capabilities: [
    {
      name: 'people.search',
      class: 'read',
      description: 'Search for people profiles matching criteria such as name, job title, company, and location.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          job_title: { type: 'array', items: { type: 'string' } },
          company: { type: 'array', items: { type: 'string' } },
          location: { type: 'array', items: { type: 'string' } },
          page: { type: 'integer', description: 'Result page number.' },
          reveal_info: {
            type: 'boolean',
            description: 'Include contact data (consumes email/phone credits).',
          },
        },
        required: [],
      },
      request: {
        method: 'POST',
        path: '/v1/people/search',
        body: {
          name: '{name}',
          job_title: '{job_title}',
          company: '{company}',
          location: '{location}',
          page: '{page}',
          reveal_info: '{reveal_info}',
        },
      },
    },
    {
      name: 'linkedin.enrich',
      class: 'mutation',
      description: 'Look up a LinkedIn profile URL and return contact data including emails and phones. Consumes credits when contact info is found.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string', description: 'URL-encoded LinkedIn profile URL.' },
          profile_only: {
            type: 'boolean',
            description: 'If true, return profile data without contact info.',
          },
        },
        required: ['profile'],
      },
      request: {
        method: 'GET',
        path: '/v1/linkedin/enrich',
        query: { profile: '{profile}', profile_only: '{profile_only}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'people.enrich',
      class: 'mutation',
      description: 'Enrich a person from a LinkedIn URL, email, or name plus company. Returns work/personal emails and phones; consumes credits when found.',
      parameters: {
        type: 'object',
        properties: {
          linkedin_url: { type: 'string' },
          email: { type: 'string' },
          full_name: { type: 'string' },
          company: { type: 'string' },
          company_domain: { type: 'string' },
          include: {
            type: 'array',
            description: 'Data types to include, e.g. work_email, personal_email, phone.',
            items: { type: 'string' },
          },
        },
        required: [],
      },
      request: {
        method: 'POST',
        path: '/v1/people/enrich',
        body: {
          linkedin_url: '{linkedin_url}',
          email: '{email}',
          full_name: '{full_name}',
          company: '{company}',
          company_domain: '{company_domain}',
          include: '{include}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'email.verify',
      class: 'mutation',
      description: 'Verify the deliverability of an email address. Consumes a verifier credit for definitive results.',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
      request: { method: 'GET', path: '/v1/email/verify', query: { email: '{email}' } },
      cas: 'native-idempotency',
      externalEffect: false,
    },
  ],
})
