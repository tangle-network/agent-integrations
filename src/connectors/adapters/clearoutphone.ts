import { declarativeRestConnector } from './declarative-rest.js'

/**
 * ClearoutPhone adapter — phone number validation and verification REST API.
 *
 * Auth: API token issued from the ClearoutPhone dashboard, sent as a Bearer token
 * on the Authorization header.
 *
 * The activepieces catalog ships three actions:
 * - `find.phone.number.carrier` — identifies the carrier of a phone number (read)
 * - `find.phone.number.is.mobile` — determines if a phone number is mobile (read)
 * - `validate.phone.number` — validates a phone number (write, metered)
 *
 * The validate action is classified as a mutation because it consumes account credits.
 * CAS is `native-idempotency` since repeated lookups of the same number are cached.
 */
export const clearoutphoneConnector = declarativeRestConnector({
  kind: 'clearoutphone',
  displayName: 'ClearoutPhone',
  description: 'Phone number validation, verification, and carrier detection via ClearoutPhone REST API.',
  auth: {
    kind: 'api-key',
    hint: 'ClearoutPhone API token. Sent as Bearer.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.clearoutphone.com',
  credentialPlacement: { kind: 'bearer' },
  test: {
    method: 'GET',
    path: '/v1/status',
  },
  capabilities: [
    {
      name: 'find.phone.number.carrier',
      class: 'read',
      description: 'Identify the carrier of a phone number.',
      parameters: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'string',
            description: 'The phone number to validate (e.g., +447766733573).',
          },
        },
        required: ['phoneNumber'],
      },
      request: {
        method: 'GET',
        path: '/v1/phone/carrier',
        query: {
          phoneNumber: '{phoneNumber}',
        },
      },
    },
    {
      name: 'find.phone.number.is.mobile',
      class: 'read',
      description: 'Determine if a phone number is mobile.',
      parameters: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'string',
            description: 'The phone number to validate (e.g., +447766733573).',
          },
        },
        required: ['phoneNumber'],
      },
      request: {
        method: 'GET',
        path: '/v1/phone/is-mobile',
        query: {
          phoneNumber: '{phoneNumber}',
        },
      },
    },
    {
      name: 'validate.phone.number',
      class: 'mutation',
      description: 'Validate a phone number. Returns validation status, carrier info, and mobile flag.',
      parameters: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'string',
            description: 'The phone number to validate (e.g., +447766733573).',
          },
        },
        required: ['phoneNumber'],
      },
      request: {
        method: 'POST',
        path: '/v1/phone/validate',
        body: {
          phoneNumber: '{phoneNumber}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
