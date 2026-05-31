import { declarativeRestConnector } from './declarative-rest.js'

export const shortIoConnector = declarativeRestConnector({
  kind: 'short-io',
  displayName: 'Short.io',
  description: 'Create, update, and manage short links with analytics and country-based targeting.',
  auth: { kind: 'api-key', hint: 'Short.io API key.' },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.short.io/api/links',
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'links.create',
      class: 'mutation',
      description: 'Create a short link.',
      parameters: {
        type: 'object',
        properties: {
          originalURL: { type: 'string', description: 'The destination URL.' },
          country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code.' },
          title: { type: 'string', description: 'Link title.' },
          cloaking: { type: 'boolean', description: 'Enable cloaking.' },
          password: { type: 'string', description: 'Password protection.' },
          redirectType: { type: 'string', description: 'HTTP redirect status code.' },
          path: { type: 'string', description: 'Custom short path.' },
        },
        required: ['originalURL'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          originalURL: '{originalURL}',
          country: '{country}',
          title: '{title}',
          cloaking: '{cloaking}',
          password: '{password}',
          redirectType: '{redirectType}',
          path: '{path}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'links.update',
      class: 'mutation',
      description: 'Update a short link.',
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string', description: 'The ID of the short link.' },
          originalURL: { type: 'string', description: 'The destination URL.' },
          title: { type: 'string', description: 'Link title.' },
          archived: { type: 'boolean', description: 'Archive the link.' },
        },
        required: ['linkId'],
      },
      request: {
        method: 'PUT',
        path: '/{linkId}',
        body: {
          originalURL: '{originalURL}',
          title: '{title}',
          archived: '{archived}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'links.delete',
      class: 'mutation',
      description: 'Delete a short link.',
      parameters: {
        type: 'object',
        properties: { linkId: { type: 'string', description: 'The ID of the short link.' } },
        required: ['linkId'],
      },
      request: { method: 'DELETE', path: '/{linkId}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'links.get',
      class: 'read',
      description: 'Get a short link by path.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'Domain name.' }, path: { type: 'string', description: 'Short link path.' } },
        required: ['domain', 'path'],
      },
      request: { method: 'GET', path: '/by-path/{domain}/{path}' },
    },
    {
      name: 'links.list',
      class: 'read',
      description: 'List short links.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max results (1-150, default 50).' },
          pageToken: { type: 'string', description: 'Pagination token.' },
          beforeDate: { type: 'string', description: 'Filter by creation date (before).' },
          afterDate: { type: 'string', description: 'Filter by creation date (after).' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/',
        query: {
          limit: '{limit}',
          pageToken: '{pageToken}',
          beforeDate: '{beforeDate}',
          afterDate: '{afterDate}',
        },
      },
    },
    {
      name: 'links.clicks',
      class: 'read',
      description: 'Get click statistics for a link.',
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string', description: 'The ID of the short link.' },
          period: { type: 'string', description: 'Time period (e.g., today, last7days, last30days).' },
          tz: { type: 'string', description: 'Timezone for statistics.' },
        },
        required: ['linkId', 'period'],
      },
      request: {
        method: 'GET',
        path: '/{linkId}/clicks',
        query: { period: '{period}', tz: '{tz}' },
      },
    },
    {
      name: 'targeting.create',
      class: 'mutation',
      description: 'Create a country targeting rule.',
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string', description: 'The ID of the short link.' },
          country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code.' },
          originalURL: { type: 'string', description: 'Country-specific redirect URL.' },
        },
        required: ['linkId', 'country', 'originalURL'],
      },
      request: {
        method: 'POST',
        path: '/{linkId}/country-rules',
        body: {
          country: '{country}',
          originalURL: '{originalURL}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
