import { declarativeRestConnector } from './declarative-rest.js'

// Hightouch — List and inspect Reverse ETL syncs, sources, destinations, and runs, and trigger sync runs.
// Auth: api-key. Base: https://api.hightouch.com/api/v1. Docs: https://hightouch.com/docs/api-reference
export const hightouchConnector = declarativeRestConnector({
  kind: 'hightouch',
  displayName: 'Hightouch',
  description: 'List and inspect Reverse ETL syncs, sources, destinations, and runs, and trigger sync runs.',
  auth: {
    kind: 'api-key',
    hint: 'API key from Settings -> API keys (Add API key). Sent as the Authorization: Bearer header.',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.hightouch.com/api/v1',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/syncs' },
  capabilities: [
    {
      name: 'syncs.list',
      class: 'read',
      description: 'List configured syncs in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          modelId: { type: 'number' },
          slug: { type: 'string' },
          orderBy: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/syncs',
        query: {
          limit: '{limit}',
          offset: '{offset}',
          modelId: '{modelId}',
          slug: '{slug}',
          orderBy: '{orderBy}',
        },
      },
    },
    {
      name: 'syncs.get',
      class: 'read',
      description: 'Retrieve a single sync by its id.',
      parameters: {
        type: 'object',
        properties: { syncId: { type: 'number' } },
        required: ['syncId'],
      },
      request: { method: 'GET', path: '/syncs/{syncId}' },
    },
    {
      name: 'syncs.list_runs',
      class: 'read',
      description: 'List the runs (execution history and status) for a sync.',
      parameters: {
        type: 'object',
        properties: {
          syncId: { type: 'number' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          runId: { type: 'number' },
          orderBy: { type: 'string' },
        },
        required: ['syncId'],
      },
      request: {
        method: 'GET',
        path: '/syncs/{syncId}/runs',
        query: {
          limit: '{limit}',
          offset: '{offset}',
          runId: '{runId}',
          orderBy: '{orderBy}',
        },
      },
    },
    {
      name: 'sources.list',
      class: 'read',
      description: 'List configured data sources.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          name: { type: 'string' },
          slug: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/sources',
        query: { limit: '{limit}', offset: '{offset}', name: '{name}', slug: '{slug}' },
      },
    },
    {
      name: 'destinations.list',
      class: 'read',
      description: 'List configured destinations.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          name: { type: 'string' },
          slug: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/destinations',
        query: { limit: '{limit}', offset: '{offset}', name: '{name}', slug: '{slug}' },
      },
    },
    {
      name: 'syncs.trigger',
      class: 'mutation',
      description: 'Trigger a run of the given sync, optionally forcing a full resync.',
      parameters: {
        type: 'object',
        properties: {
          syncId: { type: 'string' },
          fullResync: { type: 'boolean' },
          resetCDC: { type: 'boolean' },
        },
        required: ['syncId'],
      },
      request: {
        method: 'POST',
        path: '/syncs/{syncId}/trigger',
        body: { fullResync: '{fullResync}', resetCDC: '{resetCDC}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
