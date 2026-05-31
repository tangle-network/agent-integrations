import { declarativeRestConnector } from './declarative-rest.js'

export const barcodeLookupConnector = declarativeRestConnector({
  kind: 'barcode-lookup',
  displayName: 'Barcode Lookup',
  description: 'Look up product information by UPC, EAN, or ISBN barcode number.',
  auth: { kind: 'api-key', hint: 'Barcode Lookup API key, sent as the "key" query parameter.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.barcodelookup.com/v3',
  credentialPlacement: { kind: 'query', parameter: 'key' },
  test: { method: 'GET', path: '/products', query: { barcode: '9780262033848' } },
  capabilities: [
    {
      name: 'search.by.barcode',
      class: 'read',
      description: 'Look up product information for a UPC, EAN, or ISBN barcode.',
      parameters: {
        type: 'object',
        properties: {
          barcode: {
            type: 'string',
            description: 'The barcode/UPC/EAN/ISBN number to search for.',
          },
          formatted: {
            type: 'boolean',
            description: 'Return results in a clean, easy-to-read format.',
          },
        },
        required: ['barcode'],
      },
      request: {
        method: 'GET',
        path: '/products',
        query: {
          barcode: '{barcode}',
          formatted: '{formatted}',
        },
      },
    },
  ],
})
