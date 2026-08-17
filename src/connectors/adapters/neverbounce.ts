import { declarativeRestConnector } from './declarative-rest.js'

/**
 * NeverBounce single-address verification API.
 *
 * Every verification consumes provider credits even though the upstream call
 * is a GET. Model it as an idempotent mutation so approval and spend policy can
 * distinguish it from a free lookup.
 */
export const neverbounceConnector = declarativeRestConnector({
  kind: 'neverbounce',
  displayName: 'NeverBounce',
  description: 'Verify email deliverability with the NeverBounce API.',
  auth: {
    kind: 'api-key',
    hint: 'NeverBounce API key from Apps > API in the NeverBounce dashboard.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.neverbounce.com/v4.2',
  credentialPlacement: { kind: 'query', parameter: 'key' },
  test: {
    method: 'GET',
    path: '/account/info',
  },
  capabilities: [
    {
      name: 'verify.email.address',
      class: 'mutation',
      description:
        'Verify one email address and return deliverability status such as valid, invalid, disposable, catch-all, or unknown.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'Email address to verify.',
          },
        },
        required: ['email'],
      },
      request: {
        method: 'GET',
        path: '/single/check',
        query: { email: '{email}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
