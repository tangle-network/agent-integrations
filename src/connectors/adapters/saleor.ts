import { declarativeRestConnector } from './declarative-rest.js'

export const saleorConnector = declarativeRestConnector({
  kind: 'saleor',
  displayName: 'Saleor',
  description: 'Query Saleor GraphQL API, retrieve orders, and add order notes.',
  auth: {
    kind: 'api-key',
    hint: 'Saleor API token.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiUrl' },
  test: { method: 'POST', path: '/', body: { query: '{ shop { name } }' } },
  capabilities: [
    {
      name: 'graphql.query',
      class: 'read',
      description: 'Execute a raw GraphQL query against Saleor API.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'GraphQL query string' },
          variables: { type: 'object', description: 'GraphQL query variables' },
        },
        required: ['query'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: { query: '{query}', variables: '{variables}' },
      },
    },
    {
      name: 'orders.get',
      class: 'read',
      description: 'Retrieve a Saleor order by ID.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Order ID' },
        },
        required: ['orderId'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query: 'query GetOrder($id: ID!) { order(id: $id) { id number userEmail total { gross { amount } } } }',
          variables: { id: '{orderId}' },
        },
      },
    },
    {
      name: 'orders.addNote',
      class: 'mutation',
      description: 'Add a note to a Saleor order.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Order ID' },
          message: { type: 'string', description: 'Note message' },
        },
        required: ['orderId', 'message'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query: 'mutation AddOrderNote($id: ID!, $message: String!) { orderAddNote(order: $id, input: { message: $message }) { order { id } errors { field message } } }',
          variables: { id: '{orderId}', message: '{message}' },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'orders.cancel',
      class: 'mutation',
      description: 'Cancel a Saleor order.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Order ID' },
        },
        required: ['orderId'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query: 'mutation CancelOrder($id: ID!) { orderCancel(id: $id) { order { id status } errors { field message code } } }',
          variables: { id: '{orderId}' },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'orders.fulfill',
      class: 'mutation',
      description: 'Mark an order line as fulfilled by creating a fulfillment for the given quantities.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Order ID' },
          lines: {
            type: 'array',
            description: 'Order lines to fulfill. Each entry is an OrderFulfillLineInput.',
            items: {
              type: 'object',
              properties: {
                orderLineId: { type: 'string' },
                stocks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      quantity: { type: 'number' },
                      warehouse: { type: 'string' },
                    },
                    required: ['quantity', 'warehouse'],
                  },
                },
              },
              required: ['orderLineId', 'stocks'],
            },
          },
          notifyCustomer: { type: 'boolean', description: 'Whether to notify the customer. Defaults to true caller-side.' },
        },
        required: ['orderId', 'lines', 'notifyCustomer'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query: 'mutation FulfillOrder($order: ID!, $input: OrderFulfillInput!) { orderFulfill(order: $order, input: $input) { fulfillments { id status } errors { field message code } } }',
          variables: {
            order: '{orderId}',
            input: { lines: '{lines}', notifyCustomer: '{notifyCustomer}' },
          },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'orders.refund',
      class: 'mutation',
      description: 'Refund a Saleor order by creating an order refund.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Order ID' },
          amount: { type: 'number', description: 'Refund amount in the order currency.' },
        },
        required: ['orderId', 'amount'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query: 'mutation RefundOrder($id: ID!, $amount: PositiveDecimal!) { orderRefund(id: $id, amount: $amount) { order { id paymentStatus } errors { field message code } } }',
          variables: { id: '{orderId}', amount: '{amount}' },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'orders.update',
      class: 'mutation',
      description: 'Update order metadata or status (billing/shipping address, user email, language).',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Order ID' },
          input: {
            type: 'object',
            description: 'OrderUpdateInput fields (e.g. billingAddress, shippingAddress, userEmail, languageCode).',
          },
        },
        required: ['orderId', 'input'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query: 'mutation UpdateOrder($id: ID!, $input: OrderUpdateInput!) { orderUpdate(id: $id, input: $input) { order { id status } errors { field message code } } }',
          variables: { id: '{orderId}', input: '{input}' },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
