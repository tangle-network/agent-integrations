import { declarativeRestConnector } from './declarative-rest.js'

export const dappierConnector = declarativeRestConnector({
  kind: 'dappier',
  displayName: 'Dappier',
  description: 'Real-time web search, sports news, stock market data, and lifestyle news search.',
  auth: { kind: 'api-key', hint: 'Dappier API Key from https://platform.dappier.com/profile/api-keys' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.dappier.com/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'search.realTimeWeb',
      class: 'read',
      description: 'Perform a real-time web search with optional domain filtering.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query or URL' },
          similarity_top_k: { type: 'integer', description: 'Number of results to return (default: 9)' },
          ref: { type: 'string', description: 'Preferred domain to restrict results' },
          num_articles_ref: { type: 'integer', description: 'Minimum articles from the preferred domain' },
          search_algorithm: { type: 'string', description: 'Search algorithm to use for matching' },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/search/realTimeWebSearch',
        query: {
          query: '{query}',
          similarity_top_k: '{similarity_top_k}',
          ref: '{ref}',
          num_articles_ref: '{num_articles_ref}',
          search_algorithm: '{search_algorithm}',
        },
      },
    },
    {
      name: 'search.sportsNews',
      class: 'read',
      description: 'Search sports news with optional domain filtering.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query or URL' },
          similarity_top_k: { type: 'integer', description: 'Number of results to return (default: 9)' },
          ref: { type: 'string', description: 'Preferred domain to restrict results' },
          num_articles_ref: { type: 'integer', description: 'Minimum articles from the preferred domain' },
          search_algorithm: { type: 'string', description: 'Search algorithm to use for matching' },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/search/sportsNewsSearch',
        query: {
          query: '{query}',
          similarity_top_k: '{similarity_top_k}',
          ref: '{ref}',
          num_articles_ref: '{num_articles_ref}',
          search_algorithm: '{search_algorithm}',
        },
      },
    },
    {
      name: 'search.stockMarketData',
      class: 'read',
      description: 'Search stock market data and financial information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query or stock symbol' },
          similarity_top_k: { type: 'integer', description: 'Number of results to return (default: 9)' },
          ref: { type: 'string', description: 'Preferred domain to restrict results' },
          num_articles_ref: { type: 'integer', description: 'Minimum articles from the preferred domain' },
          search_algorithm: { type: 'string', description: 'Search algorithm to use for matching' },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/search/stockMarketDataSearch',
        query: {
          query: '{query}',
          similarity_top_k: '{similarity_top_k}',
          ref: '{ref}',
          num_articles_ref: '{num_articles_ref}',
          search_algorithm: '{search_algorithm}',
        },
      },
    },
    {
      name: 'search.lifestyleNews',
      class: 'read',
      description: 'Search lifestyle news and entertainment content.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query or URL' },
          similarity_top_k: { type: 'integer', description: 'Number of results to return (default: 9)' },
          ref: { type: 'string', description: 'Preferred domain to restrict results' },
          num_articles_ref: { type: 'integer', description: 'Minimum articles from the preferred domain' },
          search_algorithm: { type: 'string', description: 'Search algorithm to use for matching' },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/search/lifestyleNewsSearch',
        query: {
          query: '{query}',
          similarity_top_k: '{similarity_top_k}',
          ref: '{ref}',
          num_articles_ref: '{num_articles_ref}',
          search_algorithm: '{search_algorithm}',
        },
      },
    },
  ],
})
