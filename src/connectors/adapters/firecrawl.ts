import { declarativeRestConnector } from './declarative-rest.js'

export const firecrawlConnector = declarativeRestConnector({
  kind: 'firecrawl',
  displayName: 'Firecrawl',
  description: 'Extract structured data from websites using AI with natural language prompts.',
  auth: { kind: 'api-key', hint: 'Firecrawl API key (sent as Bearer token).' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.firecrawl.dev/v1',
  test: { method: 'GET', path: '/team/credit-usage' },
  capabilities: [
    {
      name: 'scrape',
      class: 'mutation',
      description: 'Scrape a single URL and return its content in the requested formats.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          formats: { type: 'array', items: { type: 'string' } },
          onlyMainContent: { type: 'boolean' },
          timeout: { type: 'integer' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/scrape',
        body: {
          url: '{url}',
          formats: '{formats}',
          onlyMainContent: '{onlyMainContent}',
          timeout: '{timeout}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'extract',
      class: 'mutation',
      description: 'Extract structured data from one or more URLs using a prompt and JSON schema.',
      parameters: {
        type: 'object',
        properties: {
          urls: { type: 'array', items: { type: 'string' } },
          prompt: { type: 'string' },
          schema: { type: 'object' },
          enableWebSearch: { type: 'boolean' },
        },
        required: ['urls'],
      },
      request: {
        method: 'POST',
        path: '/extract',
        body: {
          urls: '{urls}',
          prompt: '{prompt}',
          schema: '{schema}',
          enableWebSearch: '{enableWebSearch}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'crawl',
      class: 'mutation',
      description: 'Start a crawl job from a base URL, optionally bounded by a page limit and webhook.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          limit: { type: 'integer' },
          includeSubdomains: { type: 'boolean' },
          webhook: { type: 'object' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/crawl',
        body: {
          url: '{url}',
          limit: '{limit}',
          allowSubdomains: '{includeSubdomains}',
          webhook: '{webhook}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'crawl.results',
      class: 'read',
      description: 'Fetch the current status and accumulated pages of a previously started crawl job.',
      parameters: {
        type: 'object',
        properties: { crawlId: { type: 'string' } },
        required: ['crawlId'],
      },
      request: { method: 'GET', path: '/crawl/{crawlId}' },
    },
    {
      name: 'map',
      class: 'read',
      description: 'Return a map of URLs reachable from the given base URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          limit: { type: 'integer' },
          includeSubdomains: { type: 'boolean' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/map',
        body: {
          url: '{url}',
          limit: '{limit}',
          includeSubdomains: '{includeSubdomains}',
        },
      },
    },
  ],
})
