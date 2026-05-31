import { declarativeRestConnector } from './declarative-rest.js'

// eBay's REST APIs sit behind a standard OAuth2 authorization-code flow with
// two non-standard wrinkles the runtime has to know about:
//
//   1. The authorize endpoint lives at `https://auth.ebay.com/oauth2/authorize`
//      and the token endpoint at `https://api.ebay.com/identity/v1/oauth2/token`.
//      User access tokens are short-lived (~2h) but the issued refresh token is
//      long-lived (~18 months); the standard `refresh_token` grant is supported.
//      Sandbox lives on `auth.sandbox.ebay.com` / `api.sandbox.ebay.com`; the
//      production URLs here are the default and the sandbox host is consumer
//      opt-in via `metadata.apiBaseUrl`.
//
//   2. Some Sell APIs (Fulfillment, Inventory, Account) require an
//      `X-EBAY-C-MARKETPLACE-ID` header to disambiguate the seller's marketplace
//      (`EBAY_US`, `EBAY_GB`, `EBAY_DE`, ...). Callers persist the active
//      marketplace on `metadata.marketplaceId`; capability requests interpolate
//      `{marketplaceId}` from args so callers can override per-request.
//
// The action pack covers eBay's three highest-traffic seller resources for
// agent workflows — Inventory Items (search/get/create/update), Fulfillment
// Orders (search/get/ship), and Identity (the connected user / seller) — which
// together back the `commerce` action pack declared in the coverage catalog.

export const ebayConnector = declarativeRestConnector({
  kind: 'ebay',
  displayName: 'eBay',
  description: 'Manage eBay seller inventory items and fulfillment orders, and read the connected user identity.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://auth.ebay.com/oauth2/authorize',
    tokenUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
    scopes: [
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/sell.marketing',
      'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
    ],
    clientIdEnv: 'EBAY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'EBAY_OAUTH_CLIENT_SECRET',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  // Production by default; consumers persist `metadata.apiBaseUrl =
  // "https://api.sandbox.ebay.com"` to route a connection at the sandbox.
  baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://api.ebay.com' },
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { accept: 'application/json' },
  // The privileges endpoint is the canonical liveness check — cheap, always
  // available for tokens carrying any sell.* scope, returns the seller's
  // current selling limits.
  test: { method: 'GET', path: 'sell/account/v1/privilege' },
  capabilities: [
    {
      name: 'inventory_items.search',
      class: 'read',
      description: 'List inventory items for the connected seller with pagination.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Page size (eBay default 25, max 200).' },
          offset: { type: 'integer', minimum: 0, description: 'Zero-based offset of the first item to return.' },
        },
      },
      request: {
        method: 'GET',
        path: 'sell/inventory/v1/inventory_item',
        query: {
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['https://api.ebay.com/oauth/api_scope/sell.inventory'],
    },
    {
      name: 'inventory_items.get',
      class: 'read',
      description: 'Read a single inventory item by SKU.',
      parameters: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Seller-defined inventory SKU.' },
        },
        required: ['sku'],
      },
      request: {
        method: 'GET',
        path: 'sell/inventory/v1/inventory_item/{sku}',
      },
      requiredScopes: ['https://api.ebay.com/oauth/api_scope/sell.inventory'],
    },
    {
      name: 'inventory_items.upsert',
      class: 'mutation',
      description: 'Create or fully replace an inventory item identified by SKU (eBay PUT semantics are upsert).',
      parameters: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Seller-defined inventory SKU.' },
          marketplaceId: { type: 'string', description: 'Marketplace id, e.g. EBAY_US. Defaults to Content-Language en-US.' },
          item: {
            type: 'object',
            description: 'Inventory item payload (product, condition, availability, packageWeightAndSize).',
          },
        },
        required: ['sku', 'item'],
      },
      request: {
        method: 'PUT',
        path: 'sell/inventory/v1/inventory_item/{sku}',
        headers: {
          'content-language': 'en-US',
          'x-ebay-c-marketplace-id': '{marketplaceId}',
        },
        body: '{item}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://api.ebay.com/oauth/api_scope/sell.inventory'],
    },
    {
      name: 'inventory_items.delete',
      class: 'mutation',
      description: 'Delete an inventory item and all of its offers by SKU.',
      parameters: {
        type: 'object',
        properties: {
          sku: { type: 'string' },
        },
        required: ['sku'],
      },
      request: {
        method: 'DELETE',
        path: 'sell/inventory/v1/inventory_item/{sku}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['https://api.ebay.com/oauth/api_scope/sell.inventory'],
    },
    {
      name: 'offers.search',
      class: 'read',
      description: 'List offers (listings) attached to a given inventory SKU with pagination.',
      parameters: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Inventory SKU whose offers to list.' },
          marketplace_id: { type: 'string', description: 'Marketplace filter, e.g. EBAY_US.' },
          format: { type: 'string', enum: ['FIXED_PRICE', 'AUCTION'] },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['sku'],
      },
      request: {
        method: 'GET',
        path: 'sell/inventory/v1/offer',
        query: {
          sku: '{sku}',
          marketplace_id: '{marketplace_id}',
          format: '{format}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['https://api.ebay.com/oauth/api_scope/sell.inventory'],
    },
    {
      name: 'offers.publish',
      class: 'mutation',
      description: 'Publish an offer, converting it into an active eBay listing.',
      parameters: {
        type: 'object',
        properties: {
          offerId: { type: 'string', description: 'Unique identifier of the offer to publish.' },
        },
        required: ['offerId'],
      },
      request: {
        method: 'POST',
        path: 'sell/inventory/v1/offer/{offerId}/publish',
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://api.ebay.com/oauth/api_scope/sell.inventory'],
    },
    {
      name: 'orders.search',
      class: 'read',
      description: 'List fulfillment orders for the connected seller with optional filters and pagination.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: 'eBay fulfillment filter expression, e.g. "creationdate:[2026-01-01T00:00:00.000Z..]" or "orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}".',
          },
          orderIds: { type: 'string', description: 'Comma-separated list of order ids to fetch.' },
          fieldGroups: { type: 'string', description: 'Optional response projection, e.g. TAX_BREAKDOWN.' },
          marketplaceId: { type: 'string', description: 'Marketplace id header override, e.g. EBAY_US.' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: 'sell/fulfillment/v1/order',
        headers: {
          'x-ebay-c-marketplace-id': '{marketplaceId}',
        },
        query: {
          filter: '{filter}',
          orderIds: '{orderIds}',
          fieldGroups: '{fieldGroups}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['https://api.ebay.com/oauth/api_scope/sell.fulfillment'],
    },
    {
      name: 'orders.get',
      class: 'read',
      description: 'Read a single fulfillment order by id.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          fieldGroups: { type: 'string', description: 'Optional response projection, e.g. TAX_BREAKDOWN.' },
          marketplaceId: { type: 'string', description: 'Marketplace id header override, e.g. EBAY_US.' },
        },
        required: ['orderId'],
      },
      request: {
        method: 'GET',
        path: 'sell/fulfillment/v1/order/{orderId}',
        headers: {
          'x-ebay-c-marketplace-id': '{marketplaceId}',
        },
        query: {
          fieldGroups: '{fieldGroups}',
        },
      },
      requiredScopes: ['https://api.ebay.com/oauth/api_scope/sell.fulfillment'],
    },
    {
      name: 'orders.ship',
      class: 'mutation',
      description: 'Create a shipping fulfillment for an order — records carrier, tracking, and the line items shipped.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          marketplaceId: { type: 'string', description: 'Marketplace id header override, e.g. EBAY_US.' },
          fulfillment: {
            type: 'object',
            description: 'Shipping fulfillment payload (lineItems, shippedDate, shippingCarrierCode, trackingNumber).',
          },
        },
        required: ['orderId', 'fulfillment'],
      },
      request: {
        method: 'POST',
        path: 'sell/fulfillment/v1/order/{orderId}/shipping_fulfillment',
        headers: {
          'x-ebay-c-marketplace-id': '{marketplaceId}',
        },
        body: '{fulfillment}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://api.ebay.com/oauth/api_scope/sell.fulfillment'],
    },
    {
      name: 'identity.get',
      class: 'read',
      description: 'Read the connected eBay user identity (account type, registration marketplace, business / individual flags).',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'GET',
        path: 'commerce/identity/v1/user/',
      },
      requiredScopes: ['https://api.ebay.com/oauth/api_scope/commerce.identity.readonly'],
    },
  ],
})
