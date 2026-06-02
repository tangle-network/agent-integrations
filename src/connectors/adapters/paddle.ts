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
    {
      name: 'customers.create',
      class: 'mutation',
      description: 'Create a new customer.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
          locale: { type: 'string' },
          custom_data: { type: 'object' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/customers',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'customers.update',
      class: 'mutation',
      description: 'Update a customer record. Send only the fields you want to change.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          status: { type: 'string' },
          locale: { type: 'string' },
          custom_data: { type: 'object' },
        },
        required: ['customerId'],
      },
      request: {
        method: 'PATCH',
        path: '/customers/{customerId}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'prices.create',
      class: 'mutation',
      description: 'Create a new price for an existing product.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          productId: { type: 'string' },
          unitPrice: {
            type: 'object',
            description: 'Price object with amount (minor units string) and currency_code (ISO-4217).',
          },
          billingCycle: { type: 'object' },
          trialPeriod: { type: 'object' },
          taxMode: { type: 'string' },
          quantity: { type: 'object' },
          customData: { type: 'object' },
        },
        required: ['description', 'productId', 'unitPrice'],
      },
      request: {
        method: 'POST',
        path: '/prices',
        body: {
          description: '{description}',
          product_id: '{productId}',
          unit_price: '{unitPrice}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'transactions.refund',
      class: 'mutation',
      description:
        'Refund a transaction by creating a refund adjustment against it. Paddle Billing exposes refunds through POST /adjustments with action="refund".',
      parameters: {
        type: 'object',
        properties: {
          transactionId: { type: 'string' },
          reason: { type: 'string' },
          items: {
            type: 'array',
            description:
              'Line items to refund. Each item is { item_id, type: "full"|"partial"|"proration", amount? }.',
          },
        },
        required: ['transactionId', 'reason', 'items'],
      },
      request: {
        method: 'POST',
        path: '/adjustments',
        body: {
          action: 'refund',
          transaction_id: '{transactionId}',
          reason: '{reason}',
          items: '{items}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscriptions.pause',
      class: 'mutation',
      description: 'Pause a subscription.',
      parameters: {
        type: 'object',
        properties: {
          subscriptionId: { type: 'string' },
          effective_from: { type: 'string' },
          resume_at: { type: 'string' },
        },
        required: ['subscriptionId'],
      },
      request: {
        method: 'POST',
        path: '/subscriptions/{subscriptionId}/pause',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
