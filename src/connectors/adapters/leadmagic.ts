import { declarativeRestConnector } from './declarative-rest.js'

// LeadMagic — B2B data enrichment API for finding and validating work emails, mobile numbers, and enriching people and company profiles.
// Auth: api-key. Base: https://api.leadmagic.io. Docs: https://leadmagic.io/docs/v1/introduction
export const leadmagicConnector = declarativeRestConnector({
  kind: 'leadmagic',
  displayName: 'LeadMagic',
  description: 'B2B data enrichment API for finding and validating work emails, mobile numbers, and enriching people and company profiles.',
  auth: {
    kind: 'api-key',
    hint: 'API key from LeadMagic Settings -> API. Sent as the X-API-Key header.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.leadmagic.io',
  credentialPlacement: { kind: 'header', header: 'X-API-Key' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/v1/credits' },
  capabilities: [
    {
      name: 'credits.get',
      class: 'read',
      description: 'Return the current API key credit balance. Free, no credits consumed.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/v1/credits' },
    },
    {
      name: 'email.find',
      class: 'mutation',
      description: 'Find a verified work email from a person\'s name and company (charged only when an email is found).',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          domain: { type: 'string' },
          company_name: { type: 'string' },
        },
        required: ['first_name', 'last_name', 'domain'],
      },
      request: {
        method: 'POST',
        path: '/v1/people/email-finder',
        body: {
          first_name: '{first_name}',
          last_name: '{last_name}',
          domain: '{domain}',
          company_name: '{company_name}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'email.validate',
      class: 'mutation',
      description: 'Validate an email address and return valid/invalid/unknown (charged only for definitive results).',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/v1/people/email-validation',
        body: { email: '{email}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'profile.search',
      class: 'read',
      description: 'Enrich a B2B profile from a profile URL or username.',
      parameters: {
        type: 'object',
        properties: { profile_url: { type: 'string' } },
        required: ['profile_url'],
      },
      request: {
        method: 'POST',
        path: '/v1/people/profile-search',
        body: { profile_url: '{profile_url}' },
      },
    },
    {
      name: 'mobile.find',
      class: 'mutation',
      description: 'Find a mobile phone number from a profile URL or email (charged only on a successful match).',
      parameters: {
        type: 'object',
        properties: {
          profile_url: { type: 'string' },
          work_email: { type: 'string' },
          personal_email: { type: 'string' },
        },
        required: ['profile_url'],
      },
      request: {
        method: 'POST',
        path: '/v1/people/mobile-finder',
        body: {
          profile_url: '{profile_url}',
          work_email: '{work_email}',
          personal_email: '{personal_email}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'company.search',
      class: 'mutation',
      description: 'Enrich a company\'s firmographics from its domain, name, or profile URL (charged per company found).',
      parameters: {
        type: 'object',
        properties: {
          company_domain: { type: 'string' },
          company_name: { type: 'string' },
          profile_url: { type: 'string' },
        },
        required: ['company_domain'],
      },
      request: {
        method: 'POST',
        path: '/v1/companies/company-search',
        body: {
          company_domain: '{company_domain}',
          company_name: '{company_name}',
          profile_url: '{profile_url}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
  ],
})
