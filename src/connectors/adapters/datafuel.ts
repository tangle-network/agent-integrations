import { declarativeRestConnector } from './declarative-rest.js'

export const datafuelConnector = declarativeRestConnector({
  kind: 'datafuel',
  displayName: 'DataFuel',
  description: 'Crawl and scrape websites into markdown / structured JSON via the DataFuel API.',
  auth: { kind: 'api-key', hint: 'DataFuel API key (sent as Bearer token).' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.datafuel.dev',
  test: { method: 'GET', path: '/list_scrapes' },
  capabilities: [
    {
      name: 'crawl.website',
      class: 'mutation',
      description: 'Start a crawl job over a website and convert pages to markdown / structured data.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          ai_prompt: { type: 'string' },
          json_schema: { type: 'object' },
          depth: { type: 'integer' },
          limit: { type: 'integer' },
        },
        required: ['url', 'depth', 'limit'],
      },
      request: {
        method: 'POST',
        path: '/crawl',
        body: {
          url: '{url}',
          ai_prompt: '{ai_prompt}',
          json_schema: '{json_schema}',
          depth: '{depth}',
          limit: '{limit}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'scrape.website',
      class: 'mutation',
      description: 'Scrape a single URL and convert its content to markdown / structured data.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          ai_prompt: { type: 'string' },
          json_schema: { type: 'object' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/scrape',
        body: {
          url: '{url}',
          ai_prompt: '{ai_prompt}',
          json_schema: '{json_schema}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'get.scrape',
      class: 'read',
      description: 'Fetch the result of a previously-started scrape / crawl job by job_id.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          markdown: { type: 'boolean' },
          ai_response: { type: 'boolean' },
        },
        required: ['job_id'],
      },
      request: {
        method: 'GET',
        path: '/list_scrapes',
        query: {
          job_id: '{job_id}',
          markdown: '{markdown}',
          ai_response: '{ai_response}',
        },
      },
    },
  ],
})
