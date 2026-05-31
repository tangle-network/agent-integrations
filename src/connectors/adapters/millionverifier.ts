import { declarativeRestConnector } from './declarative-rest.js'

/**
 * MillionVerifier adapter — email verification REST API.
 *
 * Upstream: https://api.millionverifier.com/api/v3
 * Auth: API key. MillionVerifier forwards the credential as the `api` query
 * parameter on every verification call; there is no Authorization header.
 *
 * Catalog (`millionverifier`) declares a single action `verifyEmail`. The
 * catalog's `authFields` block is misleading — `email` and `timeout` are
 * per-call inputs, not credentials; they are modeled as capability parameters
 * here. The credential itself is the bare API key.
 */
export const millionverifierConnector = declarativeRestConnector({
  kind: 'millionverifier',
  displayName: 'MillionVerifier',
  description: 'Verify the deliverability of an email address through MillionVerifier.',
  auth: { kind: 'api-key', hint: 'MillionVerifier API key from the account dashboard.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.millionverifier.com/api/v3',
  credentialPlacement: { kind: 'query', parameter: 'api' },
  test: {
    method: 'GET',
    path: '/',
    query: { email: 'test@example.com', timeout: 10 },
  },
  capabilities: [
    {
      name: 'verify.email',
      class: 'read',
      description:
        'Verify whether an email address is deliverable. Returns MillionVerifier result codes (ok, catch_all, unknown, error, disposable, invalid) plus quality, subresult, and free/role flags.',
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
              'Maximum seconds to wait for the verification result. Defaults to 10 if omitted; range 2..60.',
            minimum: 2,
            maximum: 60,
          },
        },
        required: ['email'],
      },
      request: {
        method: 'GET',
        path: '/',
        query: {
          email: '{email}',
          timeout: '{timeout}',
        },
      },
    },
  ],
})
