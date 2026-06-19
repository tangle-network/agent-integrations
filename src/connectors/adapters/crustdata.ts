import { declarativeRestConnector } from './declarative-rest.js'

// Crustdata — Real-time B2B company and people data API for enriching, identifying, and searching companies and professional profiles.
// Auth: api-key. Base: https://api.crustdata.com. Docs: https://docs.crustdata.com/openapi-specs/2025-11-01/introduction
export const crustdataConnector = declarativeRestConnector({
  kind: 'crustdata',
  displayName: 'Crustdata',
  description: 'Real-time B2B company and people data API for enriching, identifying, and searching companies and professional profiles.',
  auth: {
    kind: 'api-key',
    hint: 'API key (token) from the Crustdata dashboard. Sent as the Authorization: Bearer header. Requests also send the x-api-version: 2025-11-01 header.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.crustdata.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json', 'x-api-version': '2025-11-01' },
  capabilities: [
    {
      name: 'company.identify',
      class: 'read',
      description: 'Resolve company domains to Crustdata company records.',
      parameters: {
        type: 'object',
        properties: { domains: { type: 'array', items: { type: 'string' } } },
        required: ['domains'],
      },
      request: { method: 'POST', path: '/company/identify', body: { domains: '{domains}' } },
    },
    {
      name: 'company.enrich',
      class: 'read',
      description: 'Retrieve full company profiles for one or more domains.',
      parameters: {
        type: 'object',
        properties: {
          domains: { type: 'array', items: { type: 'string' } },
          fields: { type: 'array', items: { type: 'string' } },
        },
        required: ['domains'],
      },
      request: {
        method: 'POST',
        path: '/company/enrich',
        body: { domains: '{domains}', fields: '{fields}' },
      },
    },
    {
      name: 'company.search',
      class: 'read',
      description: 'Search companies with filters and sorting.',
      parameters: {
        type: 'object',
        properties: { filters: { type: 'object' }, page: { type: 'integer' } },
        required: ['filters'],
      },
      request: {
        method: 'POST',
        path: '/company/search',
        body: { filters: '{filters}', page: '{page}' },
      },
    },
    {
      name: 'person.enrich',
      class: 'read',
      description: 'Enrich people by LinkedIn profile URL or business email; optionally select returned fields.',
      parameters: {
        type: 'object',
        properties: {
          professional_network_profile_urls: { type: 'array', items: { type: 'string' } },
          business_emails: { type: 'array', items: { type: 'string' } },
          fields: { type: 'array', items: { type: 'string' } },
        },
        required: ['professional_network_profile_urls'],
      },
      request: {
        method: 'POST',
        path: '/person/enrich',
        body: {
          professional_network_profile_urls: '{professional_network_profile_urls}',
          business_emails: '{business_emails}',
          fields: '{fields}',
        },
      },
    },
    {
      name: 'person.search',
      class: 'read',
      description: 'Search people with filters and sorting.',
      parameters: {
        type: 'object',
        properties: { filters: { type: 'object' }, page: { type: 'integer' } },
        required: ['filters'],
      },
      request: {
        method: 'POST',
        path: '/person/search',
        body: { filters: '{filters}', page: '{page}' },
      },
    },
  ],
})
