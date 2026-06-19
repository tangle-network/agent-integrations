import { declarativeRestConnector } from './declarative-rest.js'

// BuiltWith — Look up the technology stack, analytics, hosting, and metadata detected on any website.
// Auth: api-key. Base: https://api.builtwith.com/v22. Docs: https://api.builtwith.com/domain-api
export const builtwithConnector = declarativeRestConnector({
  kind: 'builtwith',
  displayName: 'BuiltWith',
  description: 'Look up the technology stack, analytics, hosting, and metadata detected on any website.',
  auth: {
    kind: 'api-key',
    hint: 'API key (a UUID) from your BuiltWith account dashboard under My Account -> API Access. Sent as the KEY query parameter.',
  },
  category: 'market-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.builtwith.com/v22',
  credentialPlacement: { kind: 'query', parameter: 'KEY' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/free1/api.json', query: { LOOKUP: 'builtwith.com' } },
  capabilities: [
    {
      name: 'domain.lookup',
      class: 'read',
      description: 'Return the full set of detected technologies and metadata for one or more root domains.',
      parameters: {
        type: 'object',
        properties: {
          lookup: {
            type: 'string',
            description: 'Root domain to analyze, e.g. stripe.com. Up to 16 domains may be passed as a comma-separated list.',
          },
        },
        required: ['lookup'],
      },
      request: { method: 'GET', path: '/api.json', query: { LOOKUP: '{lookup}' } },
    },
    {
      name: 'domain.free',
      class: 'read',
      description: 'Free-tier lookup returning the most popular detected technology groups for a single domain.',
      parameters: {
        type: 'object',
        properties: { lookup: { type: 'string', description: 'Root domain to analyze.' } },
        required: ['lookup'],
      },
      request: { method: 'GET', path: '/free1/api.json', query: { LOOKUP: '{lookup}' } },
    },
    {
      name: 'domain.relationships',
      class: 'read',
      description: 'Return domains that share relationships (e.g. analytics IDs, ad networks) with the given domain.',
      parameters: {
        type: 'object',
        properties: {
          lookup: { type: 'string', description: 'Root domain to find related domains for.' },
        },
        required: ['lookup'],
      },
      request: { method: 'GET', path: '/rv2/api.json', query: { LOOKUP: '{lookup}' } },
    },
    {
      name: 'company.to_url',
      class: 'read',
      description: 'Resolve a company name to its most likely website domain.',
      parameters: {
        type: 'object',
        properties: {
          company: { type: 'string', description: 'Company name to resolve to a domain.' },
        },
        required: ['company'],
      },
      request: { method: 'GET', path: '/ctu1/api.json', query: { COMPANY: '{company}' } },
    },
  ],
})
