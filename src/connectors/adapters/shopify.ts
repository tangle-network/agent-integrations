import { declarativeRestConnector } from './declarative-rest.js'

// Shopify's OAuth flow is per-shop: the authorize endpoint lives at
// `https://{shop}.myshopify.com/admin/oauth/authorize` and the token endpoint
// at `https://{shop}.myshopify.com/admin/oauth/access_token`. The
// `authorizationUrl` / `tokenUrl` declared here are templates — the connect
// flow substitutes `{shop}` at runtime once the merchant supplies their store
// handle. The Admin REST API at `https://{shop}.myshopify.com/admin/api/...`
// is then driven off the same shop handle, persisted on
// `metadata.shopDomain` (e.g. "acme-supply.myshopify.com").
//
// Two non-standard transport details the runtime has to honor:
//
//   1. Shopify rejects `Authorization: Bearer <token>` on the Admin API. The
//      access token must be sent in the `X-Shopify-Access-Token` header with
//      no prefix. The declarative-rest `header` credential placement covers
//      this with an explicit empty prefix.
//
//   2. The `X-Shopify-Access-Token` value is the same opaque token returned
//      by the OAuth token endpoint; Shopify access tokens for the Admin API
//      do NOT expire and do NOT refresh, so a refresh_token path is absent.
//      Re-installation by the merchant is the only renewal mechanism.
//
// The action pack covers Shopify's three highest-traffic Admin REST resources
// for agent workflows: Products (search/get/create/update), Orders (list/get/
// update), and Customers (search/get/create/update). Inventory level
// adjustments are also included since they are the canonical mutation that
// agent workflows reach for after products.search.

export const shopifyConnector = declarativeRestConnector({
  kind: 'shopify',
  displayName: 'Shopify',
  description: 'Manage Shopify Admin resources — products, orders, customers, and inventory levels — for a connected store.',
  auth: {
    kind: 'oauth2',
    // {shop} is substituted by the connect flow once the merchant supplies
    // the store handle (e.g. "acme-supply"). The token endpoint follows the
    // same pattern.
    authorizationUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
    tokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token',
    scopes: [
      'read_products',
      'write_products',
      'read_orders',
      'write_orders',
      'read_customers',
      'write_customers',
      'read_inventory',
      'write_inventory',
    ],
    clientIdEnv: 'SHOPIFY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SHOPIFY_OAUTH_CLIENT_SECRET',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  // The base URL is the merchant's full shop-scoped origin. Capability paths
  // are relative so URL resolution stays under `admin/api/2025-01/`.
  baseUrl: { metadataKey: 'apiBaseUrl' },
  credentialPlacement: { kind: 'header', header: 'X-Shopify-Access-Token', prefix: '' },
  defaultHeaders: { accept: 'application/json' },
  // Shop endpoint is the canonical liveness check — cheap, always available
  // for installed apps, returns the shop's name + plan.
  test: { method: 'GET', path: 'admin/api/2025-01/shop.json' },
  capabilities: [
    {
      name: 'products.search',
      class: 'read',
      description: 'List catalog products with optional title/vendor/status filters and cursor pagination.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Exact product title match.' },
          vendor: { type: 'string' },
          product_type: { type: 'string' },
          status: { type: 'string', enum: ['active', 'archived', 'draft'] },
          collection_id: { type: 'integer' },
          ids: { type: 'string', description: 'Comma-separated product ids.' },
          limit: { type: 'integer', minimum: 1, maximum: 250 },
          page_info: { type: 'string', description: 'Cursor returned by the previous page Link header.' },
          fields: { type: 'string', description: 'Comma-separated field projection, e.g. id,title,handle.' },
        },
      },
      request: {
        method: 'GET',
        path: 'admin/api/2025-01/products.json',
        query: {
          title: '{title}',
          vendor: '{vendor}',
          product_type: '{product_type}',
          status: '{status}',
          collection_id: '{collection_id}',
          ids: '{ids}',
          limit: '{limit}',
          page_info: '{page_info}',
          fields: '{fields}',
        },
      },
      requiredScopes: ['read_products'],
    },
    {
      name: 'products.get',
      class: 'read',
      description: 'Read a single catalog product by id.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'integer' },
          fields: { type: 'string', description: 'Comma-separated field projection.' },
        },
        required: ['productId'],
      },
      request: {
        method: 'GET',
        path: 'admin/api/2025-01/products/{productId}.json',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['read_products'],
    },
    {
      name: 'products.create',
      class: 'mutation',
      description: 'Create a catalog product. Shopify wraps the payload in a top-level "product" key.',
      parameters: {
        type: 'object',
        properties: {
          product: {
            type: 'object',
            description: 'Shopify product payload (title, body_html, vendor, product_type, tags, status, variants, images).',
          },
        },
        required: ['product'],
      },
      request: { method: 'POST', path: 'admin/api/2025-01/products.json', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['write_products'],
    },
    {
      name: 'products.update',
      class: 'mutation',
      description: 'Update a catalog product. Only the supplied fields under "product" are modified.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'integer' },
          product: { type: 'object', description: 'Partial product payload to merge.' },
        },
        required: ['productId', 'product'],
      },
      request: {
        method: 'PUT',
        path: 'admin/api/2025-01/products/{productId}.json',
        body: { product: '{product}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write_products'],
    },
    {
      name: 'products.delete',
      class: 'mutation',
      description: 'Delete a catalog product.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'integer' } },
        required: ['productId'],
      },
      request: { method: 'DELETE', path: 'admin/api/2025-01/products/{productId}.json' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write_products'],
    },
    {
      name: 'orders.search',
      class: 'read',
      description: 'List orders with optional status / financial_status / fulfillment_status / date filters.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'closed', 'cancelled', 'any'] },
          financial_status: {
            type: 'string',
            enum: ['authorized', 'pending', 'paid', 'partially_paid', 'refunded', 'voided', 'partially_refunded', 'any', 'unpaid'],
          },
          fulfillment_status: {
            type: 'string',
            enum: ['shipped', 'partial', 'unshipped', 'any', 'unfulfilled'],
          },
          created_at_min: { type: 'string', description: 'ISO 8601 timestamp.' },
          created_at_max: { type: 'string', description: 'ISO 8601 timestamp.' },
          updated_at_min: { type: 'string', description: 'ISO 8601 timestamp.' },
          ids: { type: 'string', description: 'Comma-separated order ids.' },
          limit: { type: 'integer', minimum: 1, maximum: 250 },
          page_info: { type: 'string', description: 'Cursor returned by the previous page Link header.' },
          fields: { type: 'string', description: 'Comma-separated field projection.' },
        },
      },
      request: {
        method: 'GET',
        path: 'admin/api/2025-01/orders.json',
        query: {
          status: '{status}',
          financial_status: '{financial_status}',
          fulfillment_status: '{fulfillment_status}',
          created_at_min: '{created_at_min}',
          created_at_max: '{created_at_max}',
          updated_at_min: '{updated_at_min}',
          ids: '{ids}',
          limit: '{limit}',
          page_info: '{page_info}',
          fields: '{fields}',
        },
      },
      requiredScopes: ['read_orders'],
    },
    {
      name: 'orders.get',
      class: 'read',
      description: 'Read a single order by id.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'integer' },
          fields: { type: 'string', description: 'Comma-separated field projection.' },
        },
        required: ['orderId'],
      },
      request: {
        method: 'GET',
        path: 'admin/api/2025-01/orders/{orderId}.json',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['read_orders'],
    },
    {
      name: 'orders.update',
      class: 'mutation',
      description: 'Update an existing order (note, tags, email, metafields, etc.).',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'integer' },
          order: { type: 'object', description: 'Partial order payload, e.g. { note: "...", tags: "vip,priority" }.' },
        },
        required: ['orderId', 'order'],
      },
      request: {
        method: 'PUT',
        path: 'admin/api/2025-01/orders/{orderId}.json',
        body: { order: '{order}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write_orders'],
    },
    {
      name: 'orders.cancel',
      class: 'mutation',
      description: 'Cancel an open order. Optionally restock and refund.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'integer' },
          reason: { type: 'string', enum: ['customer', 'fraud', 'inventory', 'declined', 'other'] },
          email: { type: 'boolean', description: 'Send a cancellation email to the customer.' },
          refund: { type: 'boolean', description: 'Issue a refund for the captured amount.' },
          restock: { type: 'boolean', description: 'Restock the cancelled items.' },
        },
        required: ['orderId'],
      },
      request: {
        method: 'POST',
        path: 'admin/api/2025-01/orders/{orderId}/cancel.json',
        body: {
          reason: '{reason}',
          email: '{email}',
          refund: '{refund}',
          restock: '{restock}',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write_orders'],
    },
    {
      name: 'customers.search',
      class: 'read',
      description: 'Search customers by query string (Shopify query syntax: email:..., tag:..., last_name:...).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Shopify customer search query, e.g. "email:jane@example.com".' },
          limit: { type: 'integer', minimum: 1, maximum: 250 },
          page_info: { type: 'string' },
          fields: { type: 'string' },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: 'admin/api/2025-01/customers/search.json',
        query: {
          query: '{query}',
          limit: '{limit}',
          page_info: '{page_info}',
          fields: '{fields}',
        },
      },
      requiredScopes: ['read_customers'],
    },
    {
      name: 'customers.get',
      class: 'read',
      description: 'Read a single customer by id.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'integer' },
          fields: { type: 'string' },
        },
        required: ['customerId'],
      },
      request: {
        method: 'GET',
        path: 'admin/api/2025-01/customers/{customerId}.json',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['read_customers'],
    },
    {
      name: 'customers.create',
      class: 'mutation',
      description: 'Create a customer. Required: first_name or last_name or email or phone.',
      parameters: {
        type: 'object',
        properties: {
          customer: {
            type: 'object',
            description: 'Shopify customer payload (first_name, last_name, email, phone, tags, addresses, accepts_marketing).',
          },
        },
        required: ['customer'],
      },
      request: { method: 'POST', path: 'admin/api/2025-01/customers.json', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['write_customers'],
    },
    {
      name: 'customers.update',
      class: 'mutation',
      description: 'Update a customer. Only the supplied fields under "customer" are modified.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'integer' },
          customer: { type: 'object', description: 'Partial customer payload to merge.' },
        },
        required: ['customerId', 'customer'],
      },
      request: {
        method: 'PUT',
        path: 'admin/api/2025-01/customers/{customerId}.json',
        body: { customer: '{customer}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write_customers'],
    },
    {
      name: 'inventory_levels.list',
      class: 'read',
      description: 'List inventory levels for given inventory_item_ids or location_ids.',
      parameters: {
        type: 'object',
        properties: {
          inventory_item_ids: { type: 'string', description: 'Comma-separated inventory_item ids.' },
          location_ids: { type: 'string', description: 'Comma-separated location ids.' },
          limit: { type: 'integer', minimum: 1, maximum: 250 },
        },
      },
      request: {
        method: 'GET',
        path: 'admin/api/2025-01/inventory_levels.json',
        query: {
          inventory_item_ids: '{inventory_item_ids}',
          location_ids: '{location_ids}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['read_inventory'],
    },
    {
      name: 'inventory_levels.set',
      class: 'mutation',
      description: 'Set the available quantity at a location to an absolute value.',
      parameters: {
        type: 'object',
        properties: {
          location_id: { type: 'integer' },
          inventory_item_id: { type: 'integer' },
          available: { type: 'integer' },
          disconnect_if_necessary: { type: 'boolean', description: 'Allow disconnecting other fulfillment services that block the update.' },
        },
        required: ['location_id', 'inventory_item_id', 'available'],
      },
      request: {
        method: 'POST',
        path: 'admin/api/2025-01/inventory_levels/set.json',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write_inventory'],
    },
    {
      name: 'inventory_levels.adjust',
      class: 'mutation',
      description: 'Adjust the available quantity at a location by a relative delta.',
      parameters: {
        type: 'object',
        properties: {
          location_id: { type: 'integer' },
          inventory_item_id: { type: 'integer' },
          available_adjustment: { type: 'integer', description: 'Positive or negative delta applied to current available.' },
        },
        required: ['location_id', 'inventory_item_id', 'available_adjustment'],
      },
      request: {
        method: 'POST',
        path: 'admin/api/2025-01/inventory_levels/adjust.json',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write_inventory'],
    },
  ],
})
