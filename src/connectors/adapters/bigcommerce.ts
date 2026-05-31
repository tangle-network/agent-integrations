import { declarativeRestConnector } from './declarative-rest.js'

// BigCommerce uses a non-standard auth shape that diverges from Bearer-style
// OAuth2 in two ways the runtime has to model explicitly:
//
//   1. The token endpoint at https://login.bigcommerce.com/oauth2/token returns
//      a permanent (non-expiring, non-refreshing) `access_token` plus the
//      `context` of the install (e.g. `stores/abc123`). The store hash extracted
//      from that context is the per-tenant API base path — every subsequent
//      request must target `https://api.bigcommerce.com/stores/{storeHash}/...`.
//      Callers MUST persist the storeHash on `metadata.storeHash`; without it
//      the adapter cannot resolve a base URL.
//
//   2. The API rejects `Authorization: Bearer <token>`. It expects the access
//      token in an `X-Auth-Token` header, with no prefix. The declarative-rest
//      `header` credential placement covers this with an explicit empty prefix.
//
// The action pack covers BigCommerce's two highest-traffic resources for agent
// workflows — Catalog Products (search/get/create/update) and Orders
// (list/get/update) — which together back the `ecommerce,orders` action pack
// declared in the coverage catalog for this provider.

export const bigcommerceConnector = declarativeRestConnector({
  kind: 'bigcommerce',
  displayName: 'BigCommerce',
  description: 'Search and update BigCommerce catalog products and orders for a connected storefront.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.bigcommerce.com/oauth2/authorize',
    tokenUrl: 'https://login.bigcommerce.com/oauth2/token',
    scopes: [
      'store_v2_products',
      'store_v2_orders',
      'store_v2_customers_read_only',
      'store_v2_information_read_only',
    ],
    clientIdEnv: 'BIGCOMMERCE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'BIGCOMMERCE_OAUTH_CLIENT_SECRET',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  // The base URL is the full store-scoped origin, including the /stores/{storeHash}/
  // prefix that BigCommerce derives at install time from the OAuth `context`
  // claim. Capability paths below are intentionally relative (no leading `/`)
  // so URL resolution stays under the store-scoped prefix instead of replacing
  // it with an absolute path.
  baseUrl: { metadataKey: 'apiBaseUrl' },
  credentialPlacement: { kind: 'header', header: 'X-Auth-Token', prefix: '' },
  defaultHeaders: { accept: 'application/json' },
  test: { method: 'GET', path: 'v2/store' },
  capabilities: [
    {
      name: 'products.search',
      class: 'read',
      description: 'Search catalog products with optional name/SKU/category filters and pagination.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial product name match (uses BigCommerce :like).' },
          sku: { type: 'string' },
          categories: { type: 'string', description: 'Comma-separated category ids (maps to BigCommerce categories:in).' },
          is_visible: { type: 'boolean' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 250 },
          include: { type: 'string', description: 'Comma-separated sub-resources, e.g. variants,images.' },
        },
      },
      request: {
        method: 'GET',
        path: 'v3/catalog/products',
        query: {
          'name:like': '{name}',
          sku: '{sku}',
          'categories:in': '{categories}',
          is_visible: '{is_visible}',
          page: '{page}',
          limit: '{limit}',
          include: '{include}',
        },
      },
      requiredScopes: ['store_v2_products'],
    },
    {
      name: 'products.get',
      class: 'read',
      description: 'Read a single catalog product by id.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'integer' },
          include: { type: 'string', description: 'Comma-separated sub-resources, e.g. variants,images,custom_fields.' },
        },
        required: ['productId'],
      },
      request: {
        method: 'GET',
        path: 'v3/catalog/products/{productId}',
        query: { include: '{include}' },
      },
      requiredScopes: ['store_v2_products'],
    },
    {
      name: 'products.create',
      class: 'mutation',
      description: 'Create a catalog product. Required fields: name, type, weight, price.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['physical', 'digital'] },
          weight: { type: 'number' },
          price: { type: 'number' },
          sku: { type: 'string' },
          description: { type: 'string' },
          categories: { type: 'array', items: { type: 'integer' } },
          inventory_level: { type: 'integer' },
          is_visible: { type: 'boolean' },
        },
        required: ['name', 'type', 'weight', 'price'],
      },
      request: { method: 'POST', path: 'v3/catalog/products', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['store_v2_products'],
    },
    {
      name: 'products.update',
      class: 'mutation',
      description: 'Patch a catalog product. Only the supplied fields are updated.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'integer' },
          fields: { type: 'object', description: 'Partial product payload to merge.' },
        },
        required: ['productId', 'fields'],
      },
      request: { method: 'PUT', path: 'v3/catalog/products/{productId}', body: '{fields}' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['store_v2_products'],
    },
    {
      name: 'orders.search',
      class: 'read',
      description: 'List orders with optional status / date / customer filters.',
      parameters: {
        type: 'object',
        properties: {
          status_id: { type: 'integer', description: 'BigCommerce order status id (e.g. 11 Awaiting Fulfillment).' },
          customer_id: { type: 'integer' },
          min_date_created: { type: 'string', description: 'RFC 2822 date string.' },
          max_date_created: { type: 'string', description: 'RFC 2822 date string.' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 250 },
        },
      },
      request: {
        method: 'GET',
        path: 'v2/orders',
        query: {
          status_id: '{status_id}',
          customer_id: '{customer_id}',
          min_date_created: '{min_date_created}',
          max_date_created: '{max_date_created}',
          page: '{page}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['store_v2_orders'],
    },
    {
      name: 'orders.get',
      class: 'read',
      description: 'Read a single order by id.',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'integer' } },
        required: ['orderId'],
      },
      request: { method: 'GET', path: 'v2/orders/{orderId}' },
      requiredScopes: ['store_v2_orders'],
    },
    {
      name: 'orders.update',
      class: 'mutation',
      description: 'Update an existing order (status, staff notes, etc.).',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'integer' },
          fields: { type: 'object', description: 'Partial order payload, e.g. { status_id: 10, staff_notes: "..." }.' },
        },
        required: ['orderId', 'fields'],
      },
      request: { method: 'PUT', path: 'v2/orders/{orderId}', body: '{fields}' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['store_v2_orders'],
    },
  ],
})
