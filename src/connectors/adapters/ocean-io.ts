import { declarativeRestConnector } from './declarative-rest.js'

// Ocean.io — Lookalike B2B company and people search plus firmographic and contact enrichment. Build target lists from an ideal customer profile and enrich records.
// Auth: api-key. Base: https://api.ocean.io. Docs: https://docs.ocean.io/
export const oceanIoConnector = declarativeRestConnector({
  kind: 'ocean-io',
  displayName: 'Ocean.io',
  description: 'Lookalike B2B company and people search plus firmographic and contact enrichment. Build target lists from an ideal customer profile and enrich records.',
  auth: {
    kind: 'api-key',
    hint: 'API token from Settings -> API tokens. Sent as the X-Api-Token header.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.ocean.io',
  credentialPlacement: { kind: 'header', header: 'X-Api-Token' },
  defaultHeaders: { 'content-type': 'application/json' },
  capabilities: [
    {
      name: 'companies.search',
      class: 'read',
      description: 'Search/lookalike companies by filters (location, size, industry, technologies) and/or seed lookalike domains.',
      parameters: {
        type: 'object',
        properties: {
          companiesFilters: { type: 'object' },
          lookalikeDomains: { type: 'array', items: { type: 'string' } },
          size: { type: 'integer' },
          searchAfter: { type: 'string' },
        },
        required: ['size'],
      },
      request: {
        method: 'POST',
        path: '/v3/search/companies',
        body: {
          companiesFilters: '{companiesFilters}',
          lookalikeDomains: '{lookalikeDomains}',
          size: '{size}',
          searchAfter: '{searchAfter}',
        },
      },
    },
    {
      name: 'people.search',
      class: 'read',
      description: 'Search people by persona filters (seniority, department) optionally scoped by company filters.',
      parameters: {
        type: 'object',
        properties: {
          peopleFilters: { type: 'object' },
          companiesFilters: { type: 'object' },
          size: { type: 'integer' },
          searchAfter: { type: 'string' },
        },
        required: ['size'],
      },
      request: {
        method: 'POST',
        path: '/v3/search/people',
        body: {
          peopleFilters: '{peopleFilters}',
          companiesFilters: '{companiesFilters}',
          size: '{size}',
          searchAfter: '{searchAfter}',
        },
      },
    },
    {
      name: 'companies.enrich',
      class: 'mutation',
      description: 'Match one company against Ocean\'s database and return firmographic, technographic, and funding data. Costs 0.1 credits per result.',
      parameters: {
        type: 'object',
        properties: { company: { type: 'object' } },
        required: ['company'],
      },
      request: { method: 'POST', path: '/v2/enrich/company', body: { company: '{company}' } },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'people.enrich',
      class: 'mutation',
      description: 'Match one person against Ocean\'s database and return profile data; optionally trigger asynchronous email/phone reveal via webhook. Costs 0.1 credits per result.',
      parameters: {
        type: 'object',
        properties: { person: { type: 'object' }, revealEmails: { type: 'object' } },
        required: ['person'],
      },
      request: {
        method: 'POST',
        path: '/v2/enrich/person',
        body: { person: '{person}', revealEmails: '{revealEmails}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'companies.autocomplete',
      class: 'read',
      description: 'Type-ahead autocomplete for company name or domain, useful for picking seed companies for a lookalike search.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/v2/autocomplete/companies',
        body: { name: '{name}' },
      },
    },
  ],
})
