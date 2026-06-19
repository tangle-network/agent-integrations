import { declarativeRestConnector } from './declarative-rest.js'

// Amplemarket — Sales intelligence and outbound platform: search and enrich people and companies, validate emails, and add leads to sequences.
// Auth: api-key. Base: https://api.amplemarket.com. Docs: https://docs.amplemarket.com/api-reference/introduction
export const amplemarketConnector = declarativeRestConnector({
  kind: 'amplemarket',
  displayName: 'Amplemarket',
  description: 'Sales intelligence and outbound platform: search and enrich people and companies, validate emails, and add leads to sequences.',
  auth: {
    kind: 'api-key',
    hint: 'Generate an API key in the Amplemarket dashboard (Settings -> API). Sent as the Authorization: Bearer header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.amplemarket.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/account-info' },
  capabilities: [
    {
      name: 'people.search',
      class: 'read',
      description: 'Search for people by job function, company, industry and other filters.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: 'Page number.' },
          page_size: { type: 'integer', description: 'Results per page.' },
          job_functions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Job functions to filter by.',
          },
          industries: {
            type: 'array',
            items: { type: 'string' },
            description: 'Industries to filter by.',
          },
        },
        required: [],
      },
      request: {
        method: 'POST',
        path: '/people/search',
        body: {
          page: '{page}',
          page_size: '{page_size}',
          job_functions: '{job_functions}',
          industries: '{industries}',
        },
      },
    },
    {
      name: 'people.find',
      class: 'mutation',
      description: 'Enrich a single person by LinkedIn URL, email, or full name plus company. Consumes credits when contact data is revealed.',
      parameters: {
        type: 'object',
        properties: {
          linkedin_url: { type: 'string', description: 'LinkedIn profile URL.' },
          email: { type: 'string', description: 'Known email address.' },
          full_name: { type: 'string', description: 'Person\'s full name.' },
          company_name: { type: 'string', description: 'Company name (use with full_name).' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/people/find',
        query: {
          linkedin_url: '{linkedin_url}',
          email: '{email}',
          full_name: '{full_name}',
          company_name: '{company_name}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'companies.find',
      class: 'read',
      description: 'Enrich a single company by LinkedIn URL, domain, or name.',
      parameters: {
        type: 'object',
        properties: {
          linkedin_url: { type: 'string', description: 'Company LinkedIn URL.' },
          domain: { type: 'string', description: 'Company domain.' },
          name: { type: 'string', description: 'Company name.' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/companies/find',
        query: { linkedin_url: '{linkedin_url}', domain: '{domain}', name: '{name}' },
      },
    },
    {
      name: 'email.validate',
      class: 'mutation',
      description: 'Start a batch email validation job. Consumes one email credit per validated address.',
      parameters: {
        type: 'object',
        properties: {
          emails: {
            type: 'array',
            items: { type: 'object', properties: { email: { type: 'string' } } },
            description: 'List of email objects to validate.',
          },
        },
        required: ['emails'],
      },
      request: { method: 'POST', path: '/email-validations', body: { emails: '{emails}' } },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'sequence.add_leads',
      class: 'mutation',
      description: 'Add one or more leads to an existing Amplemarket sequence.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Sequence ID.' },
          leads: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array of lead objects to enroll.',
          },
        },
        required: ['id', 'leads'],
      },
      request: { method: 'POST', path: '/sequences/{id}/leads', body: { leads: '{leads}' } },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
