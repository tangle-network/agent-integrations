import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Lusha — B2B contact and company data enrichment.
 *
 * Auth: API key sent in the `api_key` header.
 * Base: https://api.lusha.com
 *
 * Capabilities mirror the activepieces piece (search.companies,
 * enrich.companies) plus their natural read counterparts that the
 * upstream API exposes.
 */
export const lushaConnector = declarativeRestConnector({
  kind: 'lusha',
  displayName: 'Lusha',
  description: 'Search and enrich B2B contact and company data via the Lusha API.',
  auth: {
    kind: 'api-key',
    hint: 'API key from the Lusha dashboard. Sent as the `api_key` header on every request.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.lusha.com',
  credentialPlacement: { kind: 'header', header: 'api_key' },
  defaultHeaders: { 'Content-Type': 'application/json' },
  test: { method: 'POST', path: '/prospecting/company/search', body: { pages: { page: 0, size: 1 }, filters: {} } },
  capabilities: [
    {
      name: 'search.companies',
      class: 'read',
      description:
        'Search the Lusha company database. Pass a `requestBody` matching the Lusha prospecting search schema; pagination is appended by the caller.',
      parameters: {
        type: 'object',
        properties: {
          requestBody: {
            type: 'object',
            description: 'JSON body for the company search request (filters, etc.).',
          },
          resultLimit: {
            type: 'integer',
            description: 'Maximum number of companies to return (Lusha caps at 10000).',
            minimum: 1,
            maximum: 10000,
          },
        },
        required: ['requestBody'],
      },
      request: { method: 'POST', path: '/prospecting/company/search', body: '{requestBody}' },
    },
    {
      name: 'enrich.companies',
      class: 'mutation',
      description:
        'Enrich a set of companies previously returned by `search.companies`. Lusha treats enrich as a billed credit-consuming call, so it is modeled as a mutation.',
      parameters: {
        type: 'object',
        properties: {
          searchResults: {
            type: 'object',
            description: 'The search-results envelope returned by `search.companies`.',
          },
          resultLimit: {
            type: 'integer',
            description: 'Maximum number of companies to enrich.',
            minimum: 1,
            maximum: 10000,
          },
        },
        required: ['searchResults'],
      },
      request: {
        method: 'POST',
        path: '/prospecting/company/enrich',
        body: { companies: '{searchResults}', limit: '{resultLimit}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'search.contacts',
      class: 'read',
      description:
        'Search the Lusha contact database. Pass a `requestBody` matching the Lusha prospecting contact search schema.',
      parameters: {
        type: 'object',
        properties: {
          requestBody: {
            type: 'object',
            description: 'JSON body for the contact search request.',
          },
          resultLimit: {
            type: 'integer',
            description: 'Maximum number of contacts to return (Lusha caps at 10000).',
            minimum: 1,
            maximum: 10000,
          },
        },
        required: ['requestBody'],
      },
      request: { method: 'POST', path: '/prospecting/contact/search', body: '{requestBody}' },
    },
    {
      name: 'enrich.contacts',
      class: 'mutation',
      description:
        'Enrich a set of contacts previously returned by `search.contacts`. Consumes Lusha credits.',
      parameters: {
        type: 'object',
        properties: {
          searchResults: {
            type: 'object',
            description: 'The search-results envelope returned by `search.contacts`.',
          },
          resultLimit: {
            type: 'integer',
            description: 'Maximum number of contacts to enrich.',
            minimum: 1,
            maximum: 10000,
          },
        },
        required: ['searchResults'],
      },
      request: {
        method: 'POST',
        path: '/prospecting/contact/enrich',
        body: { contacts: '{searchResults}', limit: '{resultLimit}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
