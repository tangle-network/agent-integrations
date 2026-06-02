import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Clearout adapter — email verification REST API at https://api.clearout.io.
 *
 * Auth: API token issued from the Clearout dashboard, sent as a Bearer token
 * on the Authorization header (the placement Clearout documents for its v2
 * REST surface).
 *
 * The activepieces catalog ships a single action — `instant.verify` — backed
 * by `POST /v2/email_verify/instant`, which scores a single email address in
 * real time. We classify it as a mutation because each call is metered and
 * consumes account credits; CAS is `native-idempotency` since the API treats
 * repeat lookups of the same address as cache hits within the verification
 * window.
 */
export const clearoutConnector = declarativeRestConnector({
  kind: 'clearout',
  displayName: 'Clearout',
  description: 'Bulk and instant email validation/verification via the Clearout REST API.',
  auth: {
    kind: 'api-key',
    hint: 'Clearout API token (Dashboard → Settings → API Tokens). Sent as Bearer.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.clearout.io',
  credentialPlacement: { kind: 'bearer' },
  test: {
    method: 'GET',
    path: '/users/me',
  },
  capabilities: [
    {
      name: 'instant.verify',
      class: 'mutation',
      description:
        'Verify a single email address in real time. Returns deliverability status, role/disposable/free flags, MX records, and a confidence score.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'The email address to verify.',
          },
          timeout: {
            type: 'integer',
            description:
              'Optional per-request timeout in seconds (Clearout default applies if omitted). Useful when batching from a queue.',
          },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/v2/email_verify/instant',
        body: {
          email: '{email}',
          timeout: '{timeout}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'bulk.verify.start',
      class: 'mutation',
      description:
        'Start a bulk email verification job for a previously-uploaded list. Returns a list_id to poll for status.',
      parameters: {
        type: 'object',
        properties: {
          list_id: {
            type: 'string',
            description: 'Clearout list_id returned by the file upload endpoint.',
          },
        },
        required: ['list_id'],
      },
      request: {
        method: 'POST',
        path: '/v2/email_verify/bulk',
        body: {
          list_id: '{list_id}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'bulk.verify.cancel',
      class: 'mutation',
      description: 'Cancel a running bulk email verification job by its list_id.',
      parameters: {
        type: 'object',
        properties: {
          list_id: {
            type: 'string',
            description: 'Clearout list_id of the running bulk job to cancel.',
          },
        },
        required: ['list_id'],
      },
      request: {
        method: 'POST',
        path: '/v2/email_verify/bulk/cancel',
        body: {
          list_id: '{list_id}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
