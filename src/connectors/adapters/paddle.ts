import { declarativeRestConnector } from './declarative-rest.js'

export const paddleConnector = declarativeRestConnector({
  kind: 'paddle',
  displayName: 'Paddle',
  description: 'Manage customers, subscriptions, and recurring billing with Paddle Billing.',
  auth: { kind: 'api-key', hint: 'Paddle API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.paddle.com',
  test: { method: 'GET', path: '/customers' },
  capabilities: [
    {
      name: 'customers.list',
      class: 'read',
      description: 'List customers with optional filtering.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          status: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/customers',
        query: { email: '{email}', status: '{status}', limit: '{limit}' },
      },
    },
    {
      name: 'subscriptions.get',
      class: 'read',
      description: 'Get a subscription by ID.',
      parameters: {
        type: 'object',
        properties: { subscriptionId: { type: 'string' } },
        required: ['subscriptionId'],
      },
      request: {
        method: 'GET',
        path: '/subscriptions/{subscriptionId}',
      },
    },
    {
      name: 'subscriptions.update',
      class: 'mutation',
      description: 'Update a subscription.',
      parameters: {
        type: 'object',
        properties: {
          subscriptionId: { type: 'string' },
          quantity: { type: 'number' },
          prorationBillingMode: { type: 'string' },
          customData: { type: 'object' },
        },
        required: ['subscriptionId'],
      },
      request: {
        method: 'PATCH',
        path: '/subscriptions/{subscriptionId}',
        body: {
          quantity: '{quantity}',
          proration_billing_mode: '{prorationBillingMode}',
          custom_data: '{customData}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'subscriptions.cancel',
      class: 'mutation',
      description: 'Cancel a subscription.',
      parameters: {
        type: 'object',
        properties: {
          subscriptionId: { type: 'string' },
          effectiveFrom: { type: 'string' },
        },
        required: ['subscriptionId'],
      },
      request: {
        method: 'POST',
        path: '/subscriptions/{subscriptionId}/cancel',
        body: { effective_from: '{effectiveFrom}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'transactions.create',
      class: 'mutation',
      description: 'Create a transaction.',
      parameters: {
        type: 'object',
        properties: {
          items: { type: 'array' },
          customData: { type: 'object' },
        },
        required: ['items'],
      },
      request: {
        method: 'POST',
        path: '/transactions',
        body: {
          items: '{items}',
          custom_data: '{customData}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
