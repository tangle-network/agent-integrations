import { declarativeRestConnector } from './declarative-rest.js'

export const linkupConnector = declarativeRestConnector({
  kind: 'linkup',
  displayName: 'Linkup',
  description:
    'Web search engine for AI apps. Run grounded web searches and fetch live webpage content via the Linkup API.',
  auth: { kind: 'api-key', hint: 'Linkup API key from the Linkup console.' },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.linkup.so/v1',
  test: { method: 'GET', path: '/credits/balance' },
  capabilities: [
    {
      name: 'search',
      class: 'read',
      description:
        'Run a natural-language web search grounded by Linkup. Supports standard or deep retrieval, structured output, and domain/date filters.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          depth: { type: 'string', enum: ['standard', 'deep'] },
          outputType: { type: 'string', enum: ['searchResults', 'sourcedAnswer', 'structured'] },
          structuredOutputSchema: { type: 'string' },
          includeSources: { type: 'boolean' },
          includeImages: { type: 'boolean' },
          includeInlineCitations: { type: 'boolean' },
          fromDate: { type: 'string' },
          toDate: { type: 'string' },
          includeDomains: { type: 'array', items: { type: 'string' } },
          excludeDomains: { type: 'array', items: { type: 'string' } },
          maxResults: { type: 'integer' },
        },
        required: ['q', 'depth', 'outputType'],
      },
      request: {
        method: 'POST',
        path: '/search',
        body: {
          q: '{q}',
          depth: '{depth}',
          outputType: '{outputType}',
          structuredOutputSchema: '{structuredOutputSchema}',
          includeSources: '{includeSources}',
          includeImages: '{includeImages}',
          includeInlineCitations: '{includeInlineCitations}',
          fromDate: '{fromDate}',
          toDate: '{toDate}',
          includeDomains: '{includeDomains}',
          excludeDomains: '{excludeDomains}',
          maxResults: '{maxResults}',
        },
      },
    },
    {
      name: 'fetch',
      class: 'read',
      description: 'Fetch a single webpage through Linkup, optionally rendering JavaScript and extracting images or raw HTML.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          renderJs: { type: 'boolean' },
          includeRawHtml: { type: 'boolean' },
          extractImages: { type: 'boolean' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/fetch',
        body: {
          url: '{url}',
          renderJs: '{renderJs}',
          includeRawHtml: '{includeRawHtml}',
          extractImages: '{extractImages}',
        },
      },
    },
  ],
})
