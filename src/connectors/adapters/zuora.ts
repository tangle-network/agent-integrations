import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Zuora subscription management connector — core financial operations.
 * Supports finding accounts, products, rate plans, and invoice creation.
 * Uses OAuth2 with token-based authentication.
 */
export const zuoraConnector = declarativeRestConnector({
  kind: 'zuora',
  displayName: 'Zuora',
  description:
    'Cloud-based subscription management platform. Query accounts, products, and rate plans; create invoices.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.zuora.com/apps/PersonalSettings.do?method=oauth',
    tokenUrl: 'https://rest.zuora.com/oauth/token',
    scopes: ['api'],
    clientIdEnv: 'ZUORA_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ZUORA_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://rest.zuora.com',
  test: { method: 'GET', path: '/v1/accounts' },
  capabilities: [
    {
      name: 'accounts.find',
      class: 'read',
      description: 'Find a Zuora account by account ID or name.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Account ID to retrieve.' },
        },
        required: ['accountId'],
      },
      request: { method: 'GET', path: '/v1/accounts/{accountId}' },
      requiredScopes: ['api'],
    },
    {
      name: 'products.find',
      class: 'read',
      description: 'Find a Zuora product by product ID.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID to retrieve.' },
        },
        required: ['productId'],
      },
      request: { method: 'GET', path: '/v1/products/{productId}' },
      requiredScopes: ['api'],
    },
    {
      name: 'products.rate_plans.find',
      class: 'read',
      description: 'Find a rate plan for a product by product ID and rate plan ID.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID.' },
          ratePlanId: { type: 'string', description: 'Rate plan ID to retrieve.' },
        },
        required: ['productId', 'ratePlanId'],
      },
      request: { method: 'GET', path: '/v1/products/{productId}/rate-plans/{ratePlanId}' },
      requiredScopes: ['api'],
    },
    {
      name: 'invoices.create',
      class: 'mutation',
      description: 'Create an invoice for a subscription in Zuora.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Account ID for the invoice.' },
          subscriptionId: { type: 'string', description: 'Subscription ID for the invoice.' },
          invoiceItems: {
            type: 'array',
            description: 'Array of invoice items.',
            items: { type: 'object' },
          },
        },
        required: ['accountId'],
      },
      request: {
        method: 'POST',
        path: '/v1/invoices',
        body: { accountId: '{accountId}', subscriptionId: '{subscriptionId}', items: '{invoiceItems}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['api'],
    },
    {
      name: 'subscriptions.create',
      class: 'mutation',
      description: 'Create a subscription in Zuora for an account against one or more rate plans.',
      parameters: {
        type: 'object',
        properties: {
          accountKey: { type: 'string', description: 'Account ID or account number to subscribe.' },
          contractEffectiveDate: { type: 'string', description: 'Effective date (YYYY-MM-DD) for the contract.' },
          termType: { type: 'string', enum: ['TERMED', 'EVERGREEN'], description: 'Subscription term type.' },
          subscribeToRatePlans: {
            type: 'array',
            description: 'Rate plans to subscribe the account to.',
            items: { type: 'object' },
          },
        },
        required: ['accountKey', 'contractEffectiveDate', 'subscribeToRatePlans'],
      },
      request: {
        method: 'POST',
        path: '/v1/subscriptions',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['api'],
    },
    {
      name: 'subscriptions.cancel',
      class: 'mutation',
      description: 'Cancel an existing Zuora subscription by subscription key.',
      parameters: {
        type: 'object',
        properties: {
          subscriptionKey: { type: 'string', description: 'Subscription ID or number to cancel.' },
          cancellationPolicy: {
            type: 'string',
            enum: ['EndOfCurrentTerm', 'EndOfLastInvoicePeriod', 'SpecificDate'],
            description: 'When the cancellation takes effect.',
          },
          cancellationEffectiveDate: {
            type: 'string',
            description: 'Effective cancellation date (YYYY-MM-DD); required when cancellationPolicy is SpecificDate.',
          },
        },
        required: ['subscriptionKey', 'cancellationPolicy'],
      },
      request: {
        method: 'PUT',
        path: '/v1/subscriptions/{subscriptionKey}/cancel',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['api'],
    },
    {
      name: 'subscriptions.update',
      class: 'mutation',
      description: 'Amend a Zuora subscription (add/remove/update rate plans, change term, etc.).',
      parameters: {
        type: 'object',
        properties: {
          subscriptionKey: { type: 'string', description: 'Subscription ID or number to amend.' },
          add: { type: 'array', description: 'Rate plan additions.', items: { type: 'object' } },
          remove: { type: 'array', description: 'Rate plan removals.', items: { type: 'object' } },
          update: { type: 'array', description: 'Rate plan updates.', items: { type: 'object' } },
          termInfo: { type: 'object', description: 'Optional term change instructions.' },
        },
        required: ['subscriptionKey'],
      },
      request: {
        method: 'PUT',
        path: '/v1/subscriptions/{subscriptionKey}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['api'],
    },
    {
      name: 'payments.create',
      class: 'mutation',
      description: 'Record a payment against one or more invoices in Zuora.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Account the payment belongs to.' },
          amount: { type: 'number', description: 'Payment amount.' },
          currency: { type: 'string', description: 'Three-letter ISO 4217 currency code.' },
          effectiveDate: { type: 'string', description: 'Payment effective date (YYYY-MM-DD).' },
          paymentMethodId: { type: 'string', description: 'Payment method ID to charge.' },
          invoices: {
            type: 'array',
            description: 'Invoices to apply the payment to.',
            items: { type: 'object' },
          },
        },
        required: ['accountId', 'amount', 'currency', 'effectiveDate', 'paymentMethodId'],
      },
      request: {
        method: 'POST',
        path: '/v1/payments',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['api'],
    },
  ],
})
