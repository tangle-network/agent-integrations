import { declarativeRestConnector } from './declarative-rest.js'

const transactionId = { type: 'string', description: 'Merchant transaction id.' } as const
const provider = {
  type: 'string',
  enum: ['api', 'stripe', 'square'],
  description: 'Transaction source. Defaults to api.',
} as const

export const taxjarConnector = declarativeRestConnector({
  kind: 'taxjar',
  displayName: 'TaxJar',
  description:
    'Calculate sales tax and synchronize order/refund transactions with TaxJar for reporting and filing.',
  auth: {
    kind: 'api-key',
    hint: 'TaxJar SmartCalcs API token from Account → TaxJar API.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.taxjar.com/v2',
  credentialPlacement: {
    kind: 'header',
    header: 'Authorization',
    prefix: 'Token token="',
    suffix: '"',
  },
  test: { method: 'GET', path: '/categories' },
  capabilities: [
    {
      name: 'taxes.calculate',
      class: 'read',
      description: 'Calculate sales tax for a cart or order without creating a TaxJar transaction.',
      parameters: {
        type: 'object',
        properties: {
          from_country: { type: 'string' },
          from_zip: { type: 'string' },
          from_state: { type: 'string' },
          from_city: { type: 'string' },
          from_street: { type: 'string' },
          to_country: { type: 'string' },
          to_zip: { type: 'string' },
          to_state: { type: 'string' },
          to_city: { type: 'string' },
          to_street: { type: 'string' },
          amount: { type: 'number' },
          shipping: { type: 'number' },
          customer_id: { type: 'string' },
          exemption_type: { type: 'string' },
          nexus_addresses: { type: 'array', items: { type: 'object' } },
          line_items: { type: 'array', items: { type: 'object' } },
        },
        required: ['from_country', 'from_zip', 'to_country', 'to_zip', 'amount', 'shipping'],
      },
      request: { method: 'POST', path: '/taxes', body: 'args' },
    },
    {
      name: 'rates.get',
      class: 'read',
      description: 'Read the combined sales-tax rate for a US or Canadian postal code.',
      parameters: {
        type: 'object',
        properties: {
          zip: { type: 'string' },
          country: { type: 'string' },
          state: { type: 'string' },
          city: { type: 'string' },
          street: { type: 'string' },
        },
        required: ['zip'],
      },
      request: {
        method: 'GET',
        path: '/rates/{zip}',
        query: { country: '{country}', state: '{state}', city: '{city}', street: '{street}' },
      },
    },
    {
      name: 'categories.list',
      class: 'read',
      description: 'List TaxJar product tax categories and their tax codes.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/categories' },
    },
    {
      name: 'nexus-regions.list',
      class: 'read',
      description: 'List nexus regions configured for the TaxJar account.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/nexus/regions' },
    },
    transactionRead('orders.get', '/transactions/orders/{transactionId}', 'Read a synced order transaction.'),
    transactionWrite('orders.create', 'POST', '/transactions/orders', 'Create an order transaction for reporting and filing.'),
    transactionWrite('orders.update', 'PUT', '/transactions/orders/{transactionId}', 'Update an order transaction.'),
    transactionDelete('orders.delete', '/transactions/orders/{transactionId}', 'Delete an order transaction.'),
    transactionRead('refunds.get', '/transactions/refunds/{transactionId}', 'Read a synced refund transaction.'),
    transactionWrite('refunds.create', 'POST', '/transactions/refunds', 'Create a refund transaction for reporting and filing.'),
    transactionWrite('refunds.update', 'PUT', '/transactions/refunds/{transactionId}', 'Update a refund transaction.'),
    transactionDelete('refunds.delete', '/transactions/refunds/{transactionId}', 'Delete a refund transaction.'),
  ],
})

function transactionRead(name: string, path: string, description: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: {
      type: 'object',
      properties: { transactionId, provider },
      required: ['transactionId'],
    },
    request: { method: 'GET' as const, path, query: { provider: '{provider}' } },
  }
}

function transactionWrite(
  name: string,
  method: 'POST' | 'PUT',
  path: string,
  description: string,
) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: {
      type: 'object',
      properties: {
        transactionId,
        data: {
          type: 'object',
          description: 'Provider-native TaxJar order/refund payload, including transaction_id and transaction_date.',
        },
      },
      required: method === 'POST'
        ? ['data']
        : ['transactionId', 'data'],
    },
    request: { method, path, body: '{data}' },
    cas: 'native-idempotency' as const,
    externalEffect: true,
  }
}

function transactionDelete(name: string, path: string, description: string) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: {
      type: 'object',
      properties: { transactionId, provider },
      required: ['transactionId'],
    },
    request: { method: 'DELETE' as const, path, query: { provider: '{provider}' } },
    cas: 'native-idempotency' as const,
    externalEffect: true,
  }
}
