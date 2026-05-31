import { declarativeRestConnector } from './declarative-rest.js'

export const braveSearchConnector = declarativeRestConnector({
  kind: 'brave-search',
  displayName: 'Brave Search',
  description: 'Query the Brave Search API for privacy-preserving web results.',
  auth: { kind: 'api-key', hint: 'Brave Search subscription token (X-Subscription-Token).' },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.search.brave.com/res/v1',
  credentialPlacement: { kind: 'header', header: 'X-Subscription-Token' },
  defaultHeaders: { Accept: 'application/json' },
  test: { method: 'GET', path: '/web/search', query: { q: 'brave', count: 1 } },
  capabilities: [
    {
      name: 'brave.web.search',
      class: 'read',
      description: 'Run a Brave web search query and return result documents.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query string.' },
          count: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of results (1-20).' },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/web/search',
        query: { q: '{query}', count: '{count}' },
      },
    },
  ],
})
