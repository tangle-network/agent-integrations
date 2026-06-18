import { declarativeRestConnector } from './declarative-rest.js'

// Polytomic — List and create ETL/reverse-ETL syncs, inspect sync status, and list available connection types.
// Auth: api-key. Base: https://app.polytomic.com/api. Docs: https://apidocs.polytomic.com/
export const polytomicConnector = declarativeRestConnector({
  kind: 'polytomic',
  displayName: 'Polytomic',
  description: 'List and create ETL/reverse-ETL syncs, inspect sync status, and list available connection types.',
  auth: {
    kind: 'api-key',
    hint: 'API key generated in the Polytomic Settings panel. Sent as the Authorization: Bearer header.',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.polytomic.com/api',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'syncs.list',
      class: 'read',
      description: 'List configured syncs.',
      parameters: {
        type: 'object',
        properties: {
          active: { type: 'boolean' },
          mode: { type: 'string' },
          target_connection_id: { type: 'string' },
          limit: { type: 'integer' },
          page_token: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/syncs',
        query: {
          active: '{active}',
          mode: '{mode}',
          target_connection_id: '{target_connection_id}',
          limit: '{limit}',
          page_token: '{page_token}',
        },
      },
    },
    {
      name: 'syncs.status',
      class: 'read',
      description: 'Get the current status of a sync by its id.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      request: { method: 'GET', path: '/syncs/{id}/status' },
    },
    {
      name: 'connection_types.list',
      class: 'read',
      description: 'List all connection types (source/destination connectors) supported by this deployment.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/connection_types' },
    },
    {
      name: 'syncs.create',
      class: 'mutation',
      description: 'Create a new sync from one or more models to a destination.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          target: { type: 'object' },
          mode: { type: 'string' },
          fields: { type: 'array', items: { type: 'object' } },
          schedule: { type: 'object' },
        },
        required: ['name', 'target', 'mode', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/syncs',
        body: {
          name: '{name}',
          target: '{target}',
          mode: '{mode}',
          fields: '{fields}',
          schedule: '{schedule}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
