import { declarativeRestConnector } from './declarative-rest.js'

export const webscrapingAiConnector = declarativeRestConnector({
  kind: 'webscraping-ai',
  displayName: 'WebScraping AI',
  description: 'Scrape websites and extract data using WebScraping AI.',
  auth: { kind: 'api-key', hint: 'WebScraping AI API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.webscraping.ai',
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'page.scrapeText',
      class: 'read',
      description: 'Scrape text content from a web page.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the page to scrape.' },
          renderJs: { type: 'boolean', description: 'Whether to render JavaScript.' },
        },
        required: ['url'],
      },
      request: {
        method: 'GET',
        path: '/scrape',
        query: { url: '{url}', renderJs: '{renderJs}' },
      },
    },
    {
      name: 'page.scrapeHtml',
      class: 'read',
      description: 'Scrape the full HTML structure of a web page.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the page to scrape.' },
          renderJs: { type: 'boolean', description: 'Whether to render JavaScript.' },
        },
        required: ['url'],
      },
      request: {
        method: 'GET',
        path: '/scrape',
        query: { url: '{url}', renderJs: '{renderJs}' },
      },
    },
    {
      name: 'data.extract',
      class: 'read',
      description: 'Extract structured data from a web page given a prompt.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the page to analyze.' },
          question: { type: 'string', description: 'Natural language question about the page content.' },
          renderJs: { type: 'boolean', description: 'Whether to render JavaScript.' },
        },
        required: ['url', 'question'],
      },
      request: {
        method: 'GET',
        path: '/scrape',
        query: { url: '{url}', question: '{question}', renderJs: '{renderJs}' },
      },
    },
    {
      name: 'account.info',
      class: 'read',
      description: 'Retrieve account information and usage statistics.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/account' },
    },
  ],
})
