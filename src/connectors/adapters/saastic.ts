import { declarativeRestConnector } from './declarative-rest.js'

export const saasticConnector = declarativeRestConnector({
  kind: 'saastic',
  displayName: 'Saastic',
  description: 'Create and manage customers and charges in Saastic, the SaaS management platform.',
  auth: { kind: 'api-key', hint: 'Saastic API key from https://saastic.com/settings/developers' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.saastic.com',
  test: { method: 'GET', path: '/v1/customers' },
  capabilities: [
    {
      name: 'customers.create',
      class: 'mutation',
      description: 'Create a new customer in Saastic.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Customer email address' },
          first_name: { type: 'string', description: 'Customer first name' },
          last_name: { type: 'string', description: 'Customer last name' },
          phone: { type: 'string', description: 'Customer phone number' },
          signed_up_at: { type: 'string', description: 'ISO 8601 date when customer signed up' },
        },
        required: ['email', 'first_name', 'last_name'],
      },
      request: {
        method: 'POST',
        path: '/v1/customers',
        body: {
          email: '{email}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          phone: '{phone}',
          signed_up_at: '{signed_up_at}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'charges.create',
      class: 'mutation',
      description: 'Create a charge for a customer in Saastic.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Customer email address' },
          amount: { type: 'number', description: 'Amount in the smallest currency unit' },
          currency: { type: 'string', description: 'ISO 4217 currency code (e.g., USD, EUR)' },
          charged_at: { type: 'string', description: 'ISO 8601 date when charge occurred' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/v1/charges',
        body: {
          email: '{email}',
          amount: '{amount}',
          currency: '{currency}',
          charged_at: '{charged_at}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'customers.list',
      class: 'read',
      description: 'List all customers.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Maximum number of results to return' },
          offset: { type: 'integer', description: 'Number of results to skip' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/customers',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'customers.get',
      class: 'read',
      description: 'Retrieve a customer by email.',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string', description: 'Customer email address' } },
        required: ['email'],
      },
      request: { method: 'GET', path: '/v1/customers/{email}' },
    },
    {
      name: 'customers.update',
      class: 'mutation',
      description: 'Update an existing customer profile.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Customer email address (identifier)' },
          first_name: { type: 'string', description: 'Customer first name' },
          last_name: { type: 'string', description: 'Customer last name' },
          phone: { type: 'string', description: 'Customer phone number' },
        },
        required: ['email'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/customers/{email}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'customers.delete',
      class: 'mutation',
      description: 'Delete a customer by email.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Customer email address (identifier)' },
        },
        required: ['email'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/customers/{email}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'charges.refund',
      class: 'mutation',
      description: 'Refund an existing charge.',
      parameters: {
        type: 'object',
        properties: {
          chargeId: { type: 'string', description: 'Charge ID to refund' },
          amount: { type: 'number', description: 'Optional partial refund amount; omit to refund the full charge.' },
        },
        required: ['chargeId'],
      },
      request: {
        method: 'POST',
        path: '/v1/charges/{chargeId}/refund',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscriptions.cancel',
      class: 'mutation',
      description: 'Cancel an active subscription.',
      parameters: {
        type: 'object',
        properties: {
          subscriptionId: { type: 'string', description: 'Subscription ID to cancel' },
        },
        required: ['subscriptionId'],
      },
      request: {
        method: 'POST',
        path: '/v1/subscriptions/{subscriptionId}/cancel',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
