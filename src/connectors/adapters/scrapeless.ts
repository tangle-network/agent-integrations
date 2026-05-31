import { declarativeRestConnector } from './declarative-rest.js'

export const scrapelessConnector = declarativeRestConnector({
  kind: 'scrapeless',
  displayName: 'Scrapeless',
  description: 'Scrapeless is an all-in-one and highly scalable web scraping toolkit for enterprises and developers.',
  auth: { kind: 'api-key', hint: 'Scrapeless API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.scrapeless.com',
  test: { method: 'GET', path: '/v1/health' },
  capabilities: [
    {
      name: 'search.google',
      class: 'read',
      description: 'Execute a Google search query with advanced parameters.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Search query (supports inurl:, site:, intitle:, as_dt, as_eq)' },
          hl: { type: 'string', description: 'Language code for search results (optional)' },
          gl: { type: 'string', description: 'Country code for search results (optional)' },
          limit: { type: 'integer', description: 'Maximum number of results (optional)' },
        },
        required: ['q'],
      },
      request: {
        method: 'POST',
        path: '/v1/search/google',
        body: {
          q: '{q}',
          hl: '{hl}',
          gl: '{gl}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'scrape.universal',
      class: 'read',
      description: 'Perform universal scraping on any website with optional JavaScript rendering.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to scrape' },
          jsRender: { type: 'boolean', description: 'Enable JavaScript rendering (optional)' },
          headless: { type: 'boolean', description: 'Use headless mode (optional)' },
          jsInstructions: { type: 'object', description: 'JavaScript execution instructions (optional)' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/v1/scrape/universal',
        body: {
          url: '{url}',
          jsRender: '{jsRender}',
          headless: '{headless}',
          jsInstructions: '{jsInstructions}',
        },
      },
    },
    {
      name: 'crawl.website',
      class: 'read',
      description: 'Crawl a website and extract data from multiple subpages.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to crawl' },
          limit: { type: 'integer', description: 'Maximum number of subpages to crawl' },
          block: { type: 'object', description: 'Block rules for crawling (optional)' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/v1/crawl/website',
        body: {
          url: '{url}',
          limit: '{limit}',
          block: '{block}',
        },
      },
    },
    {
      name: 'trends.google',
      class: 'read',
      description: 'Fetch Google Trends data for specified time period and regions.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Trends search query' },
          date: { type: 'string', description: 'Date range for trends' },
          dataType: { type: 'string', description: 'Type of trends data (e.g., searches, news, images)' },
          tz: { type: 'string', description: 'Time zone offset (optional)' },
          country: { type: 'string', description: 'Country code (optional)' },
        },
        required: ['q', 'date', 'dataType'],
      },
      request: {
        method: 'POST',
        path: '/v1/trends/google',
        body: {
          q: '{q}',
          date: '{date}',
          dataType: '{dataType}',
          tz: '{tz}',
          country: '{country}',
        },
      },
    },
  ],
})
