import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Tally — form builder and submission receiver.
 *
 * Tally's primary use case is as a webhook receiver for form submissions
 * (ActivePieces catalogues it as webhook-only). This adapter exposes the
 * REST API for querying forms and retrieving submission history, scoped to
 * read operations. The webhook integration flow remains outside this connector
 * (agent agents receive submissions via the hub's inbound webhook dispatcher).
 *
 * Auth: API key placed in the `Authorization: Bearer <apiKey>` header.
 *
 * Tally API refs:
 *   - GET https://api.tally.so/form/{formId} — fetch form metadata
 *   - GET https://api.tally.so/form/{formId}/response — list responses
 *
 * TODO: expand to pagination and per-response filters if the agent needs them.
 */

export const tallyConnector = declarativeRestConnector({
  kind: 'tally',
  displayName: 'Tally',
  description: 'Fetch form metadata and retrieve form submission responses from Tally.',
  auth: {
    kind: 'api-key',
    hint: 'Tally API key. Create one under Account Settings → API. Sent as Bearer token in Authorization header.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.tally.so',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Bearer ' },
  defaultHeaders: { accept: 'application/json' },
  test: { method: 'GET', path: '/form' },
  capabilities: [
    {
      name: 'form.get',
      class: 'read',
      description: 'Fetch Tally form metadata by ID.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string', description: 'Tally form ID.' },
        },
        required: ['formId'],
      },
      request: { method: 'GET', path: '/form/{formId}' },
    },
    {
      name: 'form.responses.list',
      class: 'read',
      description: 'List form submission responses. Returns paginated response records.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string', description: 'Tally form ID.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size (default 20, max 100).' },
          after: { type: 'string', description: 'Cursor for pagination. Use the cursor from the previous response.' },
        },
        required: ['formId'],
      },
      request: {
        method: 'GET',
        path: '/form/{formId}/response',
        query: {
          limit: '{limit}',
          after: '{after}',
        },
      },
    },
  ],
})
