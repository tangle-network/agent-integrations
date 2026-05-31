import { declarativeRestConnector } from './declarative-rest.js'

// Lightfunnels public REST API (https://docs.lightfunnels.com/developers/api).
// The activepieces piece authenticates with OAuth2 (authorize at
// `app.lightfunnels.com/oauth/authorize`, token exchange at
// `api.lightfunnels.com/oauth/token`) and calls the v2 REST surface at
// `api.lightfunnels.com/v2/*`. We mirror its action+trigger names verbatim so
// the agent tool registry stays aligned with the upstream catalog entry.
export const lightfunnelsConnector = declarativeRestConnector({
  kind: 'lightfunnels',
  displayName: 'Lightfunnels',
  description: 'Manage Lightfunnels products, orders, customers and funnels.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.lightfunnels.com/oauth/authorize',
    tokenUrl: 'https://api.lightfunnels.com/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnv: 'LIGHTFUNNELS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'LIGHTFUNNELS_OAUTH_CLIENT_SECRET',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.lightfunnels.com/v2',
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'list.products',
      class: 'read',
      description: 'List Lightfunnels products.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string' },
          query: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/products',
        query: { limit: '{limit}', cursor: '{cursor}', query: '{query}' },
      },
    },
    {
      name: 'get.product',
      class: 'read',
      description: 'Get a single Lightfunnels product by id.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' } },
        required: ['productId'],
      },
      request: { method: 'GET', path: '/products/{productId}' },
    },
    {
      name: 'create.product',
      class: 'mutation',
      description: 'Create a Lightfunnels product.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number' },
          compare_at_price: { type: 'number' },
          sku: { type: 'string' },
          published: { type: 'boolean' },
        },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/products',
        body: {
          title: '{title}',
          description: '{description}',
          price: '{price}',
          compare_at_price: '{compare_at_price}',
          sku: '{sku}',
          published: '{published}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'get.order',
      class: 'read',
      description: 'Get a single Lightfunnels order by id.',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
      request: { method: 'GET', path: '/orders/{orderId}' },
    },
    {
      name: 'list.orders',
      class: 'read',
      description: 'List Lightfunnels orders.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string' },
          status: { type: 'string' },
          funnel_id: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/orders',
        query: {
          limit: '{limit}',
          cursor: '{cursor}',
          status: '{status}',
          funnel_id: '{funnel_id}',
        },
      },
    },
    {
      name: 'cancel.order',
      class: 'mutation',
      description: 'Cancel a Lightfunnels order. Destructive — agent must surface confirmation.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          reason: { type: 'string' },
          refund: { type: 'boolean' },
        },
        required: ['orderId'],
      },
      request: {
        method: 'POST',
        path: '/orders/{orderId}/cancel',
        body: { reason: '{reason}', refund: '{refund}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'create.customer',
      class: 'mutation',
      description: 'Create a Lightfunnels customer record.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          phone: { type: 'string' },
          accepts_marketing: { type: 'boolean' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/customers',
        body: {
          email: '{email}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          phone: '{phone}',
          accepts_marketing: '{accepts_marketing}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'get.customer',
      class: 'read',
      description: 'Get a single Lightfunnels customer by id.',
      parameters: {
        type: 'object',
        properties: { customerId: { type: 'string' } },
        required: ['customerId'],
      },
      request: { method: 'GET', path: '/customers/{customerId}' },
    },
    {
      name: 'list.customers',
      class: 'read',
      description: 'List Lightfunnels customers.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string' },
          query: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/customers',
        query: { limit: '{limit}', cursor: '{cursor}', query: '{query}' },
      },
    },
    {
      name: 'get.funnel',
      class: 'read',
      description: 'Get a Lightfunnels funnel by id.',
      parameters: {
        type: 'object',
        properties: { funnelId: { type: 'string' } },
        required: ['funnelId'],
      },
      request: { method: 'GET', path: '/funnels/{funnelId}' },
    },
  ],
})
