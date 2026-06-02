import { declarativeRestConnector } from './declarative-rest.js'

export const apifyConnector = declarativeRestConnector({
  kind: 'apify',
  displayName: 'Apify',
  description: 'Manage Apify datasets, actors, and tasks. Get dataset items, run actors/tasks, scrape URLs, and access key-value store records.',
  auth: { kind: 'api-key', hint: 'Apify API key from settings, API & Integrations section.' },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.apify.com/v2',
  test: { method: 'GET', path: '/acts' },
  capabilities: [
    {
      name: 'datasets.items.get',
      class: 'read',
      description: 'Get items from an Apify dataset.',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string', description: 'The ID of the dataset.' },
          offset: { type: 'integer', description: 'Number of items to skip at the start.' },
          limit: { type: 'integer', description: 'Maximum number of results to return.' },
        },
        required: ['datasetId'],
      },
      request: {
        method: 'GET',
        path: '/datasets/{datasetId}/items',
        query: { offset: '{offset}', limit: '{limit}' },
      },
    },
    {
      name: 'keyvalue-stores.records.get',
      class: 'read',
      description: 'Get a record from an Apify key-value store.',
      parameters: {
        type: 'object',
        properties: {
          storeId: { type: 'string', description: 'The ID of the key-value store.' },
          recordKey: { type: 'string', description: 'The key of the record to retrieve.' },
        },
        required: ['storeId', 'recordKey'],
      },
      request: {
        method: 'GET',
        path: '/key-value-stores/{storeId}/records/{recordKey}',
      },
    },
    {
      name: 'actors.run',
      class: 'mutation',
      description: 'Run an Apify actor.',
      parameters: {
        type: 'object',
        properties: {
          actorId: { type: 'string', description: 'The ID or name of the actor to run.' },
          input: { type: 'object', description: 'Input data for the actor.' },
        },
        required: ['actorId'],
      },
      request: {
        method: 'POST',
        path: '/acts/{actorId}/runs',
        body: '{input}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.run',
      class: 'mutation',
      description: 'Run an Apify task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task to run.' },
          input: { type: 'object', description: 'Input data for the task.' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'POST',
        path: '/tasks/{taskId}/runs',
        body: '{input}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'web-scrape.url',
      class: 'mutation',
      description: 'Scrape a single URL using Apify web scraper.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to scrape. Must start with http:// or https://.' },
          crawlerType: { type: 'string', description: 'Type of crawler to use (e.g., cheerio, playwright).' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/acts/apify~web-scraper/run-sync',
        body: { url: '{url}', crawlerType: '{crawlerType}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'actor.abort',
      class: 'mutation',
      description: 'Abort a running Apify actor run.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Identifier of the actor run to abort.' },
          gracefully: {
            type: 'boolean',
            description: 'Whether to abort gracefully (send SIGINT) instead of forcibly killing the run.',
          },
        },
        required: ['runId'],
      },
      request: {
        method: 'POST',
        path: '/actor-runs/{runId}/abort',
        query: { gracefully: '{gracefully}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'actor.run.resurrect',
      class: 'mutation',
      description: 'Resurrect a finished Apify actor run.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Identifier of the finished run to resurrect.' },
          build: { type: 'string', description: 'Tag or number of the actor build to use.' },
          timeout: { type: 'integer', description: 'New timeout in seconds for the resurrected run.' },
          memory: { type: 'integer', description: 'New memory limit (in MB) for the resurrected run.' },
        },
        required: ['runId'],
      },
      request: {
        method: 'POST',
        path: '/actor-runs/{runId}/resurrect',
        query: {
          build: '{build}',
          timeout: '{timeout}',
          memory: '{memory}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'dataset.create',
      class: 'mutation',
      description: 'Create a new named Apify dataset.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the dataset to create.' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/datasets',
        query: { name: '{name}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'dataset.delete',
      class: 'mutation',
      description: 'Delete an Apify dataset.',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string', description: 'Identifier of the dataset to delete.' },
        },
        required: ['datasetId'],
      },
      request: {
        method: 'DELETE',
        path: '/datasets/{datasetId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
