import { declarativeRestConnector } from './declarative-rest.js'

export const chainalysisApiConnector = declarativeRestConnector({
  kind: 'chainalysis-api',
  displayName: 'Chainalysis Screening API',
  description: 'Screen blockchain addresses against the Chainalysis sanctions list.',
  auth: { kind: 'api-key', hint: 'Chainalysis Public API token (sent via the `Token` header).' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://public.chainalysis.com/api/v1',
  credentialPlacement: { kind: 'header', header: 'Token' },
  test: { method: 'GET', path: '/address/0x0000000000000000000000000000000000000000' },
  capabilities: [
    {
      name: 'check.address.sanction',
      class: 'mutation',
      description: 'Check whether a blockchain address appears on the Chainalysis sanctions screening list.',
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'Blockchain address to screen against the sanctions list.',
          },
        },
        required: ['address'],
      },
      request: { method: 'GET', path: '/address/{address}' },
      cas: 'native-idempotency',
      externalEffect: false,
    },
  ],
})
