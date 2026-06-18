import { declarativeRestConnector } from './declarative-rest.js'

// Bright Data — Scrape any website at scale using Bright Data's Web Unlocker (bypasses anti-bot protection) and Web Scraper API (structured dataset collection jobs).
// Auth: api-key. Base: https://api.brightdata.com. Docs: https://docs.brightdata.com/api-reference/web-scraper-api/asynchronous-requests
export const brightdataConnector = declarativeRestConnector({
  kind: 'brightdata',
  displayName: 'Bright Data',
  description: 'Scrape any website at scale using Bright Data\'s Web Unlocker (bypasses anti-bot protection) and Web Scraper API (structured dataset collection jobs).',
  auth: {
    kind: 'api-key',
    hint: 'API token from your Bright Data dashboard (Account settings -> API tokens). Sent as the Authorization: Bearer header.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.brightdata.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'POST', path: '/request' },
  capabilities: [
    {
      name: 'unlocker.request',
      class: 'read',
      description: 'Fetch a target URL through the Web Unlocker, returning the page content with anti-bot bypass, CAPTCHA solving, and JS rendering handled.',
      parameters: {
        type: 'object',
        properties: {
          zone: { type: 'string', description: 'Your Web Unlocker API zone name.' },
          url: { type: 'string', description: 'Target URL to fetch.' },
          format: {
            type: 'string',
            description: 'Response format, e.g. \'raw\' for the unmodified site response or \'json\'.',
          },
          body: {
            type: 'string',
            description: 'Optional raw POST payload to send to the target URL.',
          },
        },
        required: ['zone', 'url'],
      },
      request: {
        method: 'POST',
        path: '/request',
        body: { zone: '{zone}', url: '{url}', format: '{format}', body: '{body}' },
      },
    },
    {
      name: 'scraper.trigger',
      class: 'mutation',
      description: 'Trigger an asynchronous Web Scraper data collection job for a given dataset, returning a snapshot_id used to poll progress and download results.',
      parameters: {
        type: 'object',
        properties: {
          dataset_id: {
            type: 'string',
            description: 'Scraper dataset id, e.g. gd_xxxxxxxxxxxxxxxxx.',
          },
          format: { type: 'string', description: 'Delivery format of results, e.g. json.' },
          include_errors: { type: 'boolean', description: 'Include error records in the result set.' },
          inputs: {
            type: 'array',
            description: 'Array of input objects, each typically containing a url to scrape.',
            items: { type: 'object' },
          },
        },
        required: ['dataset_id', 'inputs'],
      },
      request: {
        method: 'POST',
        path: '/datasets/v3/trigger',
        query: {
          dataset_id: '{dataset_id}',
          format: '{format}',
          include_errors: '{include_errors}',
        },
        body: '{inputs}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'scraper.progress',
      class: 'read',
      description: 'Check the status of a Web Scraper collection job (starting, running, ready, or failed) by its snapshot_id.',
      parameters: {
        type: 'object',
        properties: {
          snapshot_id: { type: 'string', description: 'Snapshot id returned by scraper.trigger.' },
        },
        required: ['snapshot_id'],
      },
      request: { method: 'GET', path: '/datasets/v3/progress/{snapshot_id}' },
    },
    {
      name: 'scraper.snapshot',
      class: 'read',
      description: 'Download the collected records for a completed Web Scraper snapshot in the requested format.',
      parameters: {
        type: 'object',
        properties: {
          snapshot_id: { type: 'string', description: 'Snapshot id returned by scraper.trigger.' },
          format: {
            type: 'string',
            description: 'Output format, e.g. json, ndjson, jsonl, or csv.',
          },
        },
        required: ['snapshot_id'],
      },
      request: {
        method: 'GET',
        path: '/datasets/v3/snapshot/{snapshot_id}',
        query: { format: '{format}' },
      },
    },
  ],
})
