import { declarativeRestConnector } from './declarative-rest.js'

// ZenRows — Render and scrape any web page through ZenRows' Universal Scraper API, handling proxy rotation, headless browsers, and anti-bot bypass.
// Auth: api-key. Base: https://api.zenrows.com/v1/. Docs: https://docs.zenrows.com/universal-scraper-api/api-reference
export const zenrowsConnector = declarativeRestConnector({
  kind: 'zenrows',
  displayName: 'ZenRows',
  description: 'Render and scrape any web page through ZenRows\' Universal Scraper API, handling proxy rotation, headless browsers, and anti-bot bypass.',
  auth: {
    kind: 'api-key',
    hint: 'API key from your ZenRows dashboard. Sent as the apikey query parameter.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.zenrows.com/v1/',
  credentialPlacement: { kind: 'query', parameter: 'apikey' },
  capabilities: [
    {
      name: 'page.scrape',
      class: 'read',
      description: 'Fetch a URL and return its HTML, optionally rendering JavaScript and routing through premium residential proxies.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL to scrape.' },
          js_render: { type: 'boolean', description: 'Render the page with a headless browser.' },
          premium_proxy: {
            type: 'boolean',
            description: 'Route the request through residential proxies.',
          },
          proxy_country: {
            type: 'string',
            description: 'Two-letter country code for proxy geolocation.',
          },
          wait: {
            type: 'integer',
            description: 'Fixed delay in milliseconds after page load.',
          },
          wait_for: {
            type: 'string',
            description: 'CSS selector to wait for in the DOM before returning.',
          },
        },
        required: ['url'],
      },
      request: {
        method: 'GET',
        path: '/',
        query: {
          url: '{url}',
          js_render: '{js_render}',
          premium_proxy: '{premium_proxy}',
          proxy_country: '{proxy_country}',
          wait: '{wait}',
          wait_for: '{wait_for}',
        },
      },
    },
    {
      name: 'page.extract',
      class: 'read',
      description: 'Scrape a URL and return structured data extracted via CSS selectors or ZenRows\' automatic parser.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL to scrape.' },
          css_extractor: {
            type: 'string',
            description: 'JSON string mapping output keys to CSS selectors.',
          },
          autoparse: {
            type: 'boolean',
            description: 'Automatically extract structured data from supported sites.',
          },
          js_render: { type: 'boolean', description: 'Render the page with a headless browser.' },
        },
        required: ['url'],
      },
      request: {
        method: 'GET',
        path: '/',
        query: {
          url: '{url}',
          css_extractor: '{css_extractor}',
          autoparse: '{autoparse}',
          js_render: '{js_render}',
        },
      },
    },
    {
      name: 'page.markdown',
      class: 'read',
      description: 'Fetch a URL and return its content converted to Markdown, plaintext, or PDF.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL to scrape.' },
          response_type: {
            type: 'string',
            description: 'Output conversion type, e.g. markdown, plaintext, or pdf.',
          },
          js_render: { type: 'boolean', description: 'Render the page with a headless browser.' },
        },
        required: ['url'],
      },
      request: {
        method: 'GET',
        path: '/',
        query: { url: '{url}', response_type: '{response_type}', js_render: '{js_render}' },
      },
    },
  ],
})
