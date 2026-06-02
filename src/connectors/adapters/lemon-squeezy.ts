import { declarativeRestConnector } from './declarative-rest.js'

// Lemon Squeezy is a JSON:API REST surface at https://api.lemonsqueezy.com/v1.
// Auth: Authorization: Bearer <api_key> (the declarative-rest default
// `bearer` placement matches exactly).
export const lemonSqueezyConnector = declarativeRestConnector({
  kind: 'lemon-squeezy',
  displayName: 'Lemon Squeezy',
  description:
    'Lemon Squeezy payment gateway: list products, orders, subscriptions, and customers, and create hosted checkout sessions.',
  auth: {
    kind: 'api-key',
    hint: 'Lemon Squeezy API key from Settings → API. Sent as Authorization: Bearer <key>.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.lemonsqueezy.com/v1',
  // /users/me is the documented authenticated identity endpoint.
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'products.list',
      class: 'read',
      description: 'List products in a store with pagination.',
      parameters: {
        type: 'object',
        properties: {
          storeId: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          perPage: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/products',
        query: {
          'filter[store_id]': '{storeId}',
          'page[number]': '{page}',
          'page[size]': '{perPage}',
        },
      },
    },
    {
      name: 'orders.list',
      class: 'read',
      description: 'List orders, optionally filtered by store, customer email, or status.',
      parameters: {
        type: 'object',
        properties: {
          storeId: { type: 'string' },
          userEmail: { type: 'string' },
          status: {
            type: 'string',
            enum: ['pending', 'failed', 'paid', 'refunded'],
          },
          page: { type: 'integer', minimum: 1 },
          perPage: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/orders',
        query: {
          'filter[store_id]': '{storeId}',
          'filter[user_email]': '{userEmail}',
          'filter[status]': '{status}',
          'page[number]': '{page}',
          'page[size]': '{perPage}',
        },
      },
    },
    {
      name: 'orders.get',
      class: 'read',
      description: 'Get a single order by id.',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
      request: { method: 'GET', path: '/orders/{orderId}' },
    },
    {
      name: 'subscriptions.list',
      class: 'read',
      description: 'List subscriptions, optionally filtered by store or order item.',
      parameters: {
        type: 'object',
        properties: {
          storeId: { type: 'string' },
          orderItemId: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          perPage: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/subscriptions',
        query: {
          'filter[store_id]': '{storeId}',
          'filter[order_item_id]': '{orderItemId}',
          'page[number]': '{page}',
          'page[size]': '{perPage}',
        },
      },
    },
    {
      name: 'customers.list',
      class: 'read',
      description: 'List customers, optionally filtered by store or email.',
      parameters: {
        type: 'object',
        properties: {
          storeId: { type: 'string' },
          email: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          perPage: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/customers',
        query: {
          'filter[store_id]': '{storeId}',
          'filter[email]': '{email}',
          'page[number]': '{page}',
          'page[size]': '{perPage}',
        },
      },
    },
    {
      name: 'checkouts.create',
      class: 'mutation',
      description:
        'Create a hosted checkout for a variant. Returns a checkout object whose attributes.url is the hosted payment page.',
      parameters: {
        type: 'object',
        properties: {
          storeId: { type: 'string' },
          variantId: { type: 'string' },
          customerEmail: { type: 'string' },
          customerName: { type: 'string' },
          customPrice: { type: 'integer', minimum: 1 },
          discountCode: { type: 'string' },
          redirectUrl: { type: 'string' },
          expiresAt: { type: 'string' },
          customData: { type: 'object' },
        },
        required: ['storeId', 'variantId'],
      },
      // Lemon Squeezy uses the JSON:API envelope: a `data` document with
      // `type`, `attributes`, and `relationships` pointing at the store + variant.
      request: {
        method: 'POST',
        path: '/checkouts',
        body: {
          data: {
            type: 'checkouts',
            attributes: {
              checkout_data: {
                email: '{customerEmail}',
                name: '{customerName}',
                discount_code: '{discountCode}',
                custom: '{customData}',
              },
              product_options: {
                redirect_url: '{redirectUrl}',
              },
              checkout_options: {
                expires_at: '{expiresAt}',
              },
              custom_price: '{customPrice}',
            },
            relationships: {
              store: {
                data: { type: 'stores', id: '{storeId}' },
              },
              variant: {
                data: { type: 'variants', id: '{variantId}' },
              },
            },
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscriptions.cancel',
      class: 'mutation',
      description:
        'Cancel a subscription. The subscription remains active until the end of the current billing period, after which it transitions to cancelled.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: {
        method: 'DELETE',
        path: '/subscriptions/{id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'orders.issueRefund',
      class: 'mutation',
      description:
        'Issue a refund for an order. Omit `amount` to refund the full order total; otherwise pass an integer amount in cents (the smallest currency unit) for a partial refund.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          amount: {
            type: 'integer',
            minimum: 1,
            description: 'Optional partial-refund amount in cents. Omit for a full refund.',
          },
        },
        required: ['id'],
      },
      request: {
        method: 'POST',
        path: '/orders/{id}/refund',
        body: {
          data: {
            type: 'refunds',
            attributes: {
              amount: '{amount}',
            },
          },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
