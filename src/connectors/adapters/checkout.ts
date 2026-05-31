import { declarativeRestConnector } from './declarative-rest.js'

export const checkoutConnector = declarativeRestConnector({
  kind: 'checkout',
  displayName: 'Checkout.com',
  description:
    'Manage Checkout.com customers, payment links, payouts, refunds, and payment lookups via the Unified Payments API.',
  auth: { kind: 'api-key', hint: 'Checkout.com secret key (e.g., sk_...).' },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.checkout.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  test: { method: 'GET', path: '/customers' },
  capabilities: [
    {
      name: 'create.customer',
      class: 'mutation',
      description: 'Create a customer record on Checkout.com.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
          phone: {
            type: 'object',
            properties: {
              country_code: { type: 'string' },
              number: { type: 'string' },
            },
          },
          metadata: { type: 'object' },
          default: { type: 'string' },
        },
        required: ['email'],
      },
      request: { method: 'POST', path: '/customers', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'update.customer',
      class: 'mutation',
      description: 'Update an existing Checkout.com customer.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          phone: {
            type: 'object',
            properties: {
              country_code: { type: 'string' },
              number: { type: 'string' },
            },
          },
          metadata: { type: 'object' },
          default: { type: 'string' },
        },
        required: ['customerId'],
      },
      request: { method: 'PATCH', path: '/customers/{customerId}', body: 'args' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'create.payment.link',
      class: 'mutation',
      description: 'Create a hosted payment link customers can use to pay.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          currency: { type: 'string' },
          reference: { type: 'string' },
          description: { type: 'string' },
          billing: {
            type: 'object',
            properties: {
              address: {
                type: 'object',
                properties: {
                  country: { type: 'string' },
                  address_line1: { type: 'string' },
                  address_line2: { type: 'string' },
                  city: { type: 'string' },
                  state: { type: 'string' },
                  zip: { type: 'string' },
                },
              },
              phone: {
                type: 'object',
                properties: {
                  country_code: { type: 'string' },
                  number: { type: 'string' },
                },
              },
            },
          },
          customer: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              name: { type: 'string' },
            },
          },
          expires_in: { type: 'number' },
          display_name: { type: 'string' },
          return_url: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: ['amount', 'currency'],
      },
      request: { method: 'POST', path: '/payment-links', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'create.payout',
      class: 'mutation',
      description: 'Create a payout disbursing funds to a destination.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          currency: { type: 'string' },
          reference: { type: 'string' },
          description: { type: 'string' },
          source: { type: 'object' },
          destination: { type: 'object' },
          billing_descriptor: { type: 'object' },
          metadata: { type: 'object' },
        },
        required: ['amount', 'currency', 'destination'],
      },
      request: { method: 'POST', path: '/payments', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'refund.payment',
      class: 'mutation',
      description: 'Refund a previously captured payment in full or in part.',
      parameters: {
        type: 'object',
        properties: {
          paymentId: { type: 'string' },
          amount: { type: 'number' },
          reference: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: ['paymentId'],
      },
      request: { method: 'POST', path: '/payments/{paymentId}/refunds', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'get.payment.details',
      class: 'read',
      description: 'Fetch the full payment object for a given payment id.',
      parameters: {
        type: 'object',
        properties: { paymentId: { type: 'string' } },
        required: ['paymentId'],
      },
      request: { method: 'GET', path: '/payments/{paymentId}' },
    },
    {
      name: 'get.payment.actions',
      class: 'read',
      description: 'List the actions (authorize, capture, void, refund) recorded against a payment.',
      parameters: {
        type: 'object',
        properties: { paymentId: { type: 'string' } },
        required: ['paymentId'],
      },
      request: { method: 'GET', path: '/payments/{paymentId}/actions' },
    },
  ],
})
