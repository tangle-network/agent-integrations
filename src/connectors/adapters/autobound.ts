import { declarativeRestConnector } from './declarative-rest.js'

// Autobound — AI sales-intelligence API that enriches companies and contacts with buyer-intent signals for personalized outreach.
// Auth: api-key. Base: https://signals.autobound.ai/v1. Docs: https://autobound-api.readme.io/docs/introduction
export const autoboundConnector = declarativeRestConnector({
  kind: 'autobound',
  displayName: 'Autobound',
  description: 'AI sales-intelligence API that enriches companies and contacts with buyer-intent signals for personalized outreach.',
  auth: {
    kind: 'api-key',
    hint: 'API key from your Autobound account (Developer Hub). Sent as the X-API-KEY header. Base host is the Signals API at signals.autobound.ai.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://signals.autobound.ai/v1',
  credentialPlacement: { kind: 'header', header: 'X-API-KEY' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'account.get',
      class: 'read',
      description: 'Return account details and rate limits. Consumes no credits.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/account' },
    },
    {
      name: 'company.enrich',
      class: 'mutation',
      description: 'Enrich a company with intent and news signals by domain (billed per returned signal).',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          signal_types: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' },
        },
        required: ['domain'],
      },
      request: {
        method: 'POST',
        path: '/companies/enrich',
        body: { domain: '{domain}', signal_types: '{signal_types}', limit: '{limit}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'company.search',
      class: 'read',
      description: 'Search companies aggregated by entity, filtered by signal type and firmographics.',
      parameters: {
        type: 'object',
        properties: {
          signal_types: { type: 'array', items: { type: 'string' } },
          company_domains: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' },
        },
        required: ['signal_types'],
      },
      request: {
        method: 'POST',
        path: '/companies/search',
        body: {
          signal_types: '{signal_types}',
          company_domains: '{company_domains}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'contact.enrich',
      class: 'mutation',
      description: 'Enrich a contact with personal signals by email or LinkedIn URL (billed per returned signal).',
      parameters: {
        type: 'object',
        properties: {
          contact_email: { type: 'string' },
          contact_linkedin_url: { type: 'string' },
          signal_types: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' },
        },
        required: ['contact_email'],
      },
      request: {
        method: 'POST',
        path: '/contacts/enrich',
        body: {
          contact_email: '{contact_email}',
          contact_linkedin_url: '{contact_linkedin_url}',
          signal_types: '{signal_types}',
          limit: '{limit}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'contact.search',
      class: 'read',
      description: 'Search contacts aggregated by entity, filtered by signal type.',
      parameters: {
        type: 'object',
        properties: {
          signal_types: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' },
        },
        required: ['signal_types'],
      },
      request: {
        method: 'POST',
        path: '/contacts/search',
        body: { signal_types: '{signal_types}', limit: '{limit}' },
      },
    },
  ],
})
