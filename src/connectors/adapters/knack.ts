import { declarativeRestConnector } from './declarative-rest.js'

// Knack exposes a no-code database behind a REST API at api.knack.com/v1.
// Authentication requires BOTH the per-app REST API key (sent as
// `X-Knack-REST-API-Key`) and the application ID (sent as
// `X-Knack-Application-Id`). The API key is the secret credential carried
// by the connector; the application ID resolves at request time via the
// `{applicationId}` path/query placeholder which callers thread through
// invocation arguments (mirrors how the activepieces `knack` piece collects
// both authFields).
export const knackConnector = declarativeRestConnector({
  kind: 'knack',
  displayName: 'Knack',
  description:
    'Create, read, update, and delete records in a Knack no-code database object.',
  auth: {
    kind: 'api-key',
    hint: 'Knack REST API Key from Builder > Settings > API & Code. Pair with your Application ID per request.',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.knack.com/v1',
  credentialPlacement: { kind: 'header', header: 'X-Knack-REST-API-Key' },
  defaultHeaders: {
    'Content-Type': 'application/json',
  },
  // Knack does not document a public no-op ping; hitting an object's records
  // endpoint with a 1-row page validates both credentials cheaply.
  test: {
    method: 'GET',
    path: '/objects/{objectKey}/records',
    query: { rows_per_page: 1 },
    headers: { 'X-Knack-Application-Id': '{applicationId}' },
  },
  capabilities: [
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a record in the given Knack object.',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', description: 'Knack Application ID.' },
          objectKey: {
            type: 'string',
            description: 'Object key, e.g. `object_1`.',
          },
          fields: {
            type: 'object',
            description: 'Map of `field_NN` keys to values for the new record.',
          },
        },
        required: ['applicationId', 'objectKey', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/objects/{objectKey}/records',
        headers: { 'X-Knack-Application-Id': '{applicationId}' },
        body: '{fields}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'records.find',
      class: 'read',
      description:
        'Find records in a Knack object by filtering on a single field value.',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', description: 'Knack Application ID.' },
          objectKey: {
            type: 'string',
            description: 'Object key, e.g. `object_1`.',
          },
          field: {
            type: 'string',
            description: 'Field key to filter on, e.g. `field_3`.',
          },
          fieldValue: {
            type: 'string',
            description: 'Value to match against the chosen field.',
          },
          rowsPerPage: {
            type: 'integer',
            description: 'Max records to return per page (Knack caps at 1000).',
          },
          page: { type: 'integer', description: 'Page number, 1-indexed.' },
        },
        required: ['applicationId', 'objectKey', 'field', 'fieldValue'],
      },
      request: {
        method: 'GET',
        path: '/objects/{objectKey}/records',
        headers: { 'X-Knack-Application-Id': '{applicationId}' },
        query: {
          // Knack's filter syntax is JSON-encoded in a `filters` query
          // parameter. We render the rules inline so callers don't need
          // to pre-encode the structure themselves.
          filters:
            '{"match":"and","rules":[{"field":"{field}","operator":"is","value":"{fieldValue}"}]}',
          rows_per_page: '{rowsPerPage}',
          page: '{page}',
        },
      },
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update an existing Knack record by ID.',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', description: 'Knack Application ID.' },
          objectKey: {
            type: 'string',
            description: 'Object key, e.g. `object_1`.',
          },
          recordId: {
            type: 'string',
            description: 'Knack record ID returned from a prior create or find.',
          },
          fields: {
            type: 'object',
            description: 'Map of `field_NN` keys to values to update.',
          },
        },
        required: ['applicationId', 'objectKey', 'recordId', 'fields'],
      },
      request: {
        method: 'PUT',
        path: '/objects/{objectKey}/records/{recordId}',
        headers: { 'X-Knack-Application-Id': '{applicationId}' },
        body: '{fields}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a Knack record by ID.',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', description: 'Knack Application ID.' },
          objectKey: {
            type: 'string',
            description: 'Object key, e.g. `object_1`.',
          },
          recordId: {
            type: 'string',
            description: 'Knack record ID to delete.',
          },
        },
        required: ['applicationId', 'objectKey', 'recordId'],
      },
      request: {
        method: 'DELETE',
        path: '/objects/{objectKey}/records/{recordId}',
        headers: { 'X-Knack-Application-Id': '{applicationId}' },
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
