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
    },
  ],
})
