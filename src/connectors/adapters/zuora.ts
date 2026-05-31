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
  ],
})
