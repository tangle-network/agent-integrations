import { declarativeRestConnector } from './declarative-rest.js'

export const giftbitConnector = declarativeRestConnector({
  kind: 'giftbit',
  displayName: 'Giftbit',
  description: 'Send digital gift cards and rewards to recipients via email.',
  auth: {
    kind: 'api-key',
    hint: 'Giftbit API key from your merchant account settings.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.giftbit.com/v1',
  test: { method: 'GET', path: '/ping' },
  capabilities: [
    {
      name: 'rewards.send',
      class: 'mutation',
      description: 'Send a digital gift card or reward to one or more recipients via email.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Unique identifier for this order' },
          priceInCents: { type: 'integer', description: 'Reward value in cents (e.g., 2500 = $25.00)' },
          email: { type: 'string', description: 'Recipient email address' },
          firstName: { type: 'string', description: 'Recipient first name' },
          lastName: { type: 'string', description: 'Recipient last name' },
          subject: { type: 'string', description: 'Email subject line' },
          message: { type: 'string', description: 'Email body message' },
          giftTemplate: { type: 'string', description: 'Gift template ID from Giftbit account' },
          expiryDate: { type: 'string', description: 'ISO date for reward claim deadline' },
          brandCodes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Brand codes to restrict reward to specific merchants',
          },
          region: { type: 'string', description: 'Region code for full catalog rewards' },
          useFullCatalog: { type: 'boolean', description: 'Let recipient choose from all brands in region' },
          useTestbed: { type: 'boolean', description: 'Send test reward (does not charge)' },
        },
        required: ['orderId', 'priceInCents', 'email'],
      },
      request: {
        method: 'POST',
        path: '/rewards',
        body: {
          orderId: '{orderId}',
          priceInCents: '{priceInCents}',
          email: '{email}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          subject: '{subject}',
          message: '{message}',
          giftTemplate: '{giftTemplate}',
          expiryDate: '{expiryDate}',
          brandCodes: '{brandCodes}',
          region: '{region}',
          useFullCatalog: '{useFullCatalog}',
          useTestbed: '{useTestbed}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'rewards.get',
      class: 'read',
      description: 'Retrieve details of a sent reward by reward ID.',
      parameters: {
        type: 'object',
        properties: {
          rewardId: { type: 'string', description: 'Unique reward identifier' },
        },
        required: ['rewardId'],
      },
      request: {
        method: 'GET',
        path: '/rewards/{rewardId}',
      },
    },
    {
      name: 'rewards.list',
      class: 'read',
      description: 'List sent rewards with optional filtering by order ID or status.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Filter by order ID' },
          status: { type: 'string', description: 'Filter by reward status (e.g., pending, claimed, expired)' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum results to return' },
          offset: { type: 'integer', minimum: 0, description: 'Pagination offset' },
        },
      },
      request: {
        method: 'GET',
        path: '/rewards',
        query: {
          orderId: '{orderId}',
          status: '{status}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'brands.list',
      class: 'read',
      description: 'List available brands for the account and region.',
      parameters: {
        type: 'object',
        properties: {
          region: { type: 'string', description: 'Region code (e.g., US, CA, UK)' },
        },
      },
      request: {
        method: 'GET',
        path: '/brands',
        query: {
          region: '{region}',
        },
      },
    },
  ],
})
