import { declarativeRestConnector } from './declarative-rest.js'

/**
 * ZeroBounce adapter — email validation REST API at https://api.zerobounce.net.
 *
 * Auth: API token (key) from the ZeroBounce dashboard, sent as a query parameter
 * `api_key` on requests.
 *
 * The activepieces catalog ships a single action — `validate.email` — backed
 * by `GET /v2/validate`, which validates a single email address and returns
 * deliverability status, bounce type, and other metadata. We classify it as a
 * mutation because each call consumes API credits; CAS is `native-idempotency`
 * since repeat lookups return cached results within the default cache window.
 */
export const zerobounceConnector = declarativeRestConnector({
  kind: 'zerobounce',
  displayName: 'ZeroBounce',
  description: 'Email validation and verification via the ZeroBounce REST API.',
  auth: {
    kind: 'api-key',
    hint: 'ZeroBounce API key from your account dashboard.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.zerobounce.net',
  credentialPlacement: { kind: 'query', parameter: 'api_key' },
  test: {
    method: 'GET',
    path: '/v2/getcredits',
  },
  capabilities: [
    {
      name: 'validate.email',
      class: 'mutation',
      description:
        'Validate a single email address. Returns status (valid, invalid, catch-all, unknown, spamtrap, abuse), bounce type, and additional metadata.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'The email address to validate.',
          },
          ipAddress: {
            type: 'string',
            description:
              'Optional IP address of the user submitting the email address. Can improve accuracy when provided.',
          },
        },
        required: ['email'],
      },
      request: {
        method: 'GET',
        path: '/v2/validate',
        query: {
          email: '{email}',
          ip_address: '{ipAddress}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
