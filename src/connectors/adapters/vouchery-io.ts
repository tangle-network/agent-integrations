import { declarativeRestConnector } from './declarative-rest.js'

export const voucheryIoConnector = declarativeRestConnector({
  kind: 'vouchery-io',
  displayName: 'Vouchery',
  description: 'Vouchery is a voucher and gift card management platform.',
  auth: { kind: 'api-key', hint: 'Vouchery API key.' },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.vouchery.io/api/v1.0',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'vouchers.find',
      class: 'read',
      description: 'Find a voucher by code.',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string' } },
        required: ['code'],
      },
      request: { method: 'GET', path: '/vouchers/{code}' },
    },
    {
      name: 'customers.create',
      class: 'mutation',
      description: 'Create a customer in Vouchery.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: ['identifier'],
      },
      request: {
        method: 'POST',
        path: '/customers',
        body: {
          identifier: '{identifier}',
          name: '{name}',
          email: '{email}',
          metadata: '{metadata}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'vouchers.create',
      class: 'mutation',
      description: 'Create a voucher (avoucher) in Vouchery.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          value: { type: 'number' },
          expiresAt: { type: 'string' },
          customerId: { type: 'string' },
        },
        required: ['code', 'value'],
      },
      request: {
        method: 'POST',
        path: '/vouchers',
        body: {
          code: '{code}',
          value: '{value}',
          expiresAt: '{expiresAt}',
          customerId: '{customerId}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
