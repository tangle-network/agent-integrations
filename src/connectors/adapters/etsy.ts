import { type ConnectorAdapter } from '../types.js'
import { declarativeRestConnector } from './declarative-rest.js'

// Etsy Open API v3 requires BOTH an OAuth2 Bearer access token AND a per-app
// `x-api-key` header (the application's "keystring", which is the same opaque
// string Etsy issues as the OAuth2 `client_id`). Either header alone is
// rejected. Etsy is the only mainstream commerce vendor that ships this
// dual-credential shape, so we cannot use a plain `const` adapter the way
// shopify/bigcommerce do — the keystring is a deployment-level value
// resolved once and reused for every connection.
//
// Factory pattern: the consumer constructs the adapter with the keystring,
// which gets baked into `defaultHeaders` and reused for every request. The
// per-connection Bearer token still arrives via the OAuth2 credential
// placement at invocation time.
//
// OAuth2 surface:
//   - authorize: https://www.etsy.com/oauth/connect (PKCE required, S256)
//   - token:     https://api.etsy.com/v3/public/oauth/token
//   - scope shape: space-separated; "_r" / "_w" / "_d" suffixes per resource.
//
// API base: https://openapi.etsy.com/v3 — the `/application/...` prefix on
// capability paths is intentional, that's the Etsy v3 partitioning between
// public endpoints (`/application`) and host-only ones.
//
// Shop scoping: Etsy listings / transactions / receipts hang off a numeric
// `shop_id`. Sellers typically have exactly one shop; consumers resolve the
// shop_id once via `users.me` → `shops.get_for_user` and persist it on the
// connection (no `metadata.shopId` substitution is required because the
// declarative engine takes shop_id directly from the capability args).
//
// Capabilities cover the four agent-workflow-relevant resource families:
// listings (search/get/create/update/delete), shop receipts (the order
// surface — list/get/update-as-shipped), transactions (line items), and the
// shop entity itself.

export interface EtsyOptions {
  /** OAuth2 client_id, also used as the `x-api-key` header on every request.
   *  Etsy calls this the app "keystring". */
  keystring: string
}

const SCOPES = [
  'listings_r',
  'listings_w',
  'listings_d',
  'transactions_r',
  'transactions_w',
  'shops_r',
  'shops_w',
  'profile_r',
  'email_r',
]

export function etsyConnector(opts: EtsyOptions): ConnectorAdapter {
  const { keystring } = opts
  if (!keystring || typeof keystring !== 'string') {
    throw new Error('etsyConnector: keystring is required (OAuth client_id, sent as x-api-key on every request).')
  }
  return declarativeRestConnector({
    kind: 'etsy',
    displayName: 'Etsy',
    description:
      'Manage Etsy seller resources — shop listings, shop receipts (orders), transactions, and the shop entity — via the Etsy Open API v3.',
    auth: {
      kind: 'oauth2',
      authorizationUrl: 'https://www.etsy.com/oauth/connect',
      tokenUrl: 'https://api.etsy.com/v3/public/oauth/token',
      scopes: SCOPES,
      clientIdEnv: 'ETSY_OAUTH_CLIENT_ID',
      clientSecretEnv: 'ETSY_OAUTH_CLIENT_SECRET',
    },
    category: 'commerce',
    defaultConsistencyModel: 'authoritative',
    baseUrl: 'https://openapi.etsy.com',
    credentialPlacement: { kind: 'bearer' },
    // x-api-key is constant per deployment (it's the OAuth client_id reused
    // as a static app identifier — Etsy doesn't rotate it per request).
    defaultHeaders: {
      'x-api-key': keystring,
      accept: 'application/json',
    },
    // /v3/application/openapi-ping is Etsy's documented authenticated
    // liveness probe — it returns the same application_id present in the
    // Bearer token + x-api-key without billing against any quota.
    test: { method: 'GET', path: 'v3/application/openapi-ping' },
    capabilities: [
      {
        name: 'users.me',
        class: 'read',
        description: 'Read the authenticated user, including their numeric user_id. Used to bootstrap shop_id resolution.',
        parameters: { type: 'object', properties: {} },
        request: { method: 'GET', path: 'v3/application/users/me' },
        requiredScopes: ['profile_r'],
      },
      {
        name: 'shops.get_for_user',
        class: 'read',
        description: 'Resolve the shop owned by a given Etsy user. Returns the shop_id used by every listing/receipt call.',
        parameters: {
          type: 'object',
          properties: {
            user_id: { type: 'integer', description: 'Etsy numeric user_id (from users.me).' },
          },
          required: ['user_id'],
        },
        request: { method: 'GET', path: 'v3/application/users/{user_id}/shops' },
        requiredScopes: ['shops_r'],
      },
      {
        name: 'shops.get',
        class: 'read',
        description: 'Read a single shop by shop_id.',
        parameters: {
          type: 'object',
          properties: { shop_id: { type: 'integer' } },
          required: ['shop_id'],
        },
        request: { method: 'GET', path: 'v3/application/shops/{shop_id}' },
        requiredScopes: ['shops_r'],
      },
      {
        name: 'shops.update',
        class: 'mutation',
        description: 'Update mutable shop attributes (title, announcement, sale_message, policy_welcome).',
        parameters: {
          type: 'object',
          properties: {
            shop_id: { type: 'integer' },
            title: { type: 'string' },
            announcement: { type: 'string' },
            sale_message: { type: 'string' },
            policy_welcome: { type: 'string' },
            policy_payment: { type: 'string' },
            policy_shipping: { type: 'string' },
            policy_refunds: { type: 'string' },
            policy_additional: { type: 'string' },
            policy_seller_info: { type: 'string' },
            policy_privacy: { type: 'string' },
          },
          required: ['shop_id'],
        },
        request: {
          method: 'PUT',
          path: 'v3/application/shops/{shop_id}',
          body: {
            title: '{title}',
            announcement: '{announcement}',
            sale_message: '{sale_message}',
            policy_welcome: '{policy_welcome}',
            policy_payment: '{policy_payment}',
            policy_shipping: '{policy_shipping}',
            policy_refunds: '{policy_refunds}',
            policy_additional: '{policy_additional}',
            policy_seller_info: '{policy_seller_info}',
            policy_privacy: '{policy_privacy}',
          },
        },
        cas: 'optimistic-read-verify',
        requiredScopes: ['shops_w'],
      },
      {
        name: 'listings.search',
        class: 'read',
        description: 'List shop listings with optional state, sort, and keyword filters. Paginated by limit/offset.',
        parameters: {
          type: 'object',
          properties: {
            shop_id: { type: 'integer' },
            state: {
              type: 'string',
              enum: ['active', 'inactive', 'sold_out', 'draft', 'expired'],
              description: 'Filter by listing state. Defaults to active server-side when omitted.',
            },
            limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max 100 per page.' },
            offset: { type: 'integer', minimum: 0 },
            sort_on: {
              type: 'string',
              enum: ['created', 'price', 'updated', 'score'],
            },
            sort_order: { type: 'string', enum: ['asc', 'ascending', 'desc', 'descending', 'up', 'down'] },
            keywords: { type: 'string', description: 'Search within listing titles/descriptions.' },
            includes: {
              type: 'string',
              description: 'Comma-separated associations to inline, e.g. Images,Inventory,Translations.',
            },
          },
          required: ['shop_id'],
        },
        request: {
          method: 'GET',
          path: 'v3/application/shops/{shop_id}/listings',
          query: {
            state: '{state}',
            limit: '{limit}',
            offset: '{offset}',
            sort_on: '{sort_on}',
            sort_order: '{sort_order}',
            keywords: '{keywords}',
            includes: '{includes}',
          },
        },
        requiredScopes: ['listings_r'],
      },
      {
        name: 'listings.get',
        class: 'read',
        description: 'Read a single listing by listing_id.',
        parameters: {
          type: 'object',
          properties: {
            listing_id: { type: 'integer' },
            includes: {
              type: 'string',
              description: 'Comma-separated associations to inline, e.g. Images,Inventory,Shipping,Translations,Videos.',
            },
            language: { type: 'string', description: 'BCP-47 language tag for localized fields.' },
          },
          required: ['listing_id'],
        },
        request: {
          method: 'GET',
          path: 'v3/application/listings/{listing_id}',
          query: { includes: '{includes}', language: '{language}' },
        },
        requiredScopes: ['listings_r'],
      },
      {
        name: 'listings.create',
        class: 'mutation',
        description:
          'Create a draft shop listing. Required: quantity, title, description, price, who_made, when_made, taxonomy_id. Listing is created in `draft` state by default — caller must POST `listings.update` with state=active to publish.',
        parameters: {
          type: 'object',
          properties: {
            shop_id: { type: 'integer' },
            quantity: { type: 'integer', minimum: 1 },
            title: { type: 'string' },
            description: { type: 'string' },
            price: { type: 'number', description: 'Listing price in shop currency.' },
            who_made: { type: 'string', enum: ['i_did', 'someone_else', 'collective'] },
            when_made: {
              type: 'string',
              description: 'Etsy when_made enum, e.g. "made_to_order", "2020_2025", "before_1700".',
            },
            taxonomy_id: { type: 'integer', description: 'Etsy seller taxonomy node id.' },
            shipping_profile_id: { type: 'integer' },
            return_policy_id: { type: 'integer' },
            materials: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
            styles: { type: 'array', items: { type: 'string' } },
            item_weight: { type: 'number' },
            item_length: { type: 'number' },
            item_width: { type: 'number' },
            item_height: { type: 'number' },
            is_supply: { type: 'boolean' },
            is_personalizable: { type: 'boolean' },
            type: { type: 'string', enum: ['physical', 'download', 'both'] },
          },
          required: ['shop_id', 'quantity', 'title', 'description', 'price', 'who_made', 'when_made', 'taxonomy_id'],
        },
        request: {
          method: 'POST',
          path: 'v3/application/shops/{shop_id}/listings',
          body: {
            quantity: '{quantity}',
            title: '{title}',
            description: '{description}',
            price: '{price}',
            who_made: '{who_made}',
            when_made: '{when_made}',
            taxonomy_id: '{taxonomy_id}',
            shipping_profile_id: '{shipping_profile_id}',
            return_policy_id: '{return_policy_id}',
            materials: '{materials}',
            tags: '{tags}',
            styles: '{styles}',
            item_weight: '{item_weight}',
            item_length: '{item_length}',
            item_width: '{item_width}',
            item_height: '{item_height}',
            is_supply: '{is_supply}',
            is_personalizable: '{is_personalizable}',
            type: '{type}',
          },
        },
        cas: 'native-idempotency',
        requiredScopes: ['listings_w'],
      },
      {
        name: 'listings.update',
        class: 'mutation',
        description:
          'Update a shop listing. Only supplied fields are modified. Use `state` to publish a draft (active), retire (inactive), or move to draft.',
        parameters: {
          type: 'object',
          properties: {
            shop_id: { type: 'integer' },
            listing_id: { type: 'integer' },
            title: { type: 'string' },
            description: { type: 'string' },
            price: { type: 'number' },
            quantity: { type: 'integer', minimum: 0 },
            state: { type: 'string', enum: ['active', 'inactive', 'draft'] },
            materials: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
            taxonomy_id: { type: 'integer' },
            shipping_profile_id: { type: 'integer' },
            return_policy_id: { type: 'integer' },
            is_personalizable: { type: 'boolean' },
            featured_rank: { type: 'integer' },
          },
          required: ['shop_id', 'listing_id'],
        },
        request: {
          method: 'PATCH',
          path: 'v3/application/shops/{shop_id}/listings/{listing_id}',
          body: {
            title: '{title}',
            description: '{description}',
            price: '{price}',
            quantity: '{quantity}',
            state: '{state}',
            materials: '{materials}',
            tags: '{tags}',
            taxonomy_id: '{taxonomy_id}',
            shipping_profile_id: '{shipping_profile_id}',
            return_policy_id: '{return_policy_id}',
            is_personalizable: '{is_personalizable}',
            featured_rank: '{featured_rank}',
          },
        },
        cas: 'optimistic-read-verify',
        requiredScopes: ['listings_w'],
      },
      {
        name: 'listings.delete',
        class: 'mutation',
        description: 'Permanently delete a shop listing. Etsy enforces idempotency — repeated deletes return 404 on the same listing_id.',
        parameters: {
          type: 'object',
          properties: { listing_id: { type: 'integer' } },
          required: ['listing_id'],
        },
        request: { method: 'DELETE', path: 'v3/application/listings/{listing_id}' },
        cas: 'optimistic-read-verify',
        requiredScopes: ['listings_d'],
      },
      {
        name: 'receipts.search',
        class: 'read',
        description:
          'List shop receipts (orders). Filter by paid/shipped state and date window. Paginated by limit/offset.',
        parameters: {
          type: 'object',
          properties: {
            shop_id: { type: 'integer' },
            min_created: { type: 'integer', description: 'Unix timestamp lower bound for create_timestamp.' },
            max_created: { type: 'integer', description: 'Unix timestamp upper bound for create_timestamp.' },
            min_last_modified: { type: 'integer' },
            max_last_modified: { type: 'integer' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
            sort_on: { type: 'string', enum: ['created', 'updated', 'receipt_id'] },
            sort_order: { type: 'string', enum: ['asc', 'ascending', 'desc', 'descending', 'up', 'down'] },
            was_paid: { type: 'boolean' },
            was_shipped: { type: 'boolean' },
            was_delivered: { type: 'boolean' },
            was_canceled: { type: 'boolean' },
          },
          required: ['shop_id'],
        },
        request: {
          method: 'GET',
          path: 'v3/application/shops/{shop_id}/receipts',
          query: {
            min_created: '{min_created}',
            max_created: '{max_created}',
            min_last_modified: '{min_last_modified}',
            max_last_modified: '{max_last_modified}',
            limit: '{limit}',
            offset: '{offset}',
            sort_on: '{sort_on}',
            sort_order: '{sort_order}',
            was_paid: '{was_paid}',
            was_shipped: '{was_shipped}',
            was_delivered: '{was_delivered}',
            was_canceled: '{was_canceled}',
          },
        },
        requiredScopes: ['transactions_r'],
      },
      {
        name: 'receipts.get',
        class: 'read',
        description: 'Read a single shop receipt by receipt_id.',
        parameters: {
          type: 'object',
          properties: {
            shop_id: { type: 'integer' },
            receipt_id: { type: 'integer' },
          },
          required: ['shop_id', 'receipt_id'],
        },
        request: { method: 'GET', path: 'v3/application/shops/{shop_id}/receipts/{receipt_id}' },
        requiredScopes: ['transactions_r'],
      },
      {
        name: 'receipts.update',
        class: 'mutation',
        description: 'Update buyer-facing notes on a receipt — was_shipped/was_paid flip plus internal notes.',
        parameters: {
          type: 'object',
          properties: {
            shop_id: { type: 'integer' },
            receipt_id: { type: 'integer' },
            was_shipped: { type: 'boolean' },
            was_paid: { type: 'boolean' },
          },
          required: ['shop_id', 'receipt_id'],
        },
        request: {
          method: 'PUT',
          path: 'v3/application/shops/{shop_id}/receipts/{receipt_id}',
          body: {
            was_shipped: '{was_shipped}',
            was_paid: '{was_paid}',
          },
        },
        cas: 'optimistic-read-verify',
        requiredScopes: ['transactions_w'],
      },
      {
        name: 'receipts.create_shipment',
        class: 'mutation',
        description:
          'Mark a receipt as shipped and (optionally) attach tracking. Etsy notifies the buyer when send_bcc is true.',
        parameters: {
          type: 'object',
          properties: {
            shop_id: { type: 'integer' },
            receipt_id: { type: 'integer' },
            tracking_code: { type: 'string' },
            carrier_name: { type: 'string', description: 'Etsy carrier slug, e.g. "usps", "fedex", "ups", "dhl".' },
            send_bcc: { type: 'boolean', description: 'Send the shipment notification email to the seller as well.' },
            note_to_buyer: { type: 'string' },
          },
          required: ['shop_id', 'receipt_id'],
        },
        request: {
          method: 'POST',
          path: 'v3/application/shops/{shop_id}/receipts/{receipt_id}/tracking',
          body: {
            tracking_code: '{tracking_code}',
            carrier_name: '{carrier_name}',
            send_bcc: '{send_bcc}',
            note_to_buyer: '{note_to_buyer}',
          },
        },
        cas: 'native-idempotency',
        requiredScopes: ['transactions_w'],
      },
      {
        name: 'transactions.search',
        class: 'read',
        description: 'List individual transactions (line items) for a shop, optionally filtered to a receipt.',
        parameters: {
          type: 'object',
          properties: {
            shop_id: { type: 'integer' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
          },
          required: ['shop_id'],
        },
        request: {
          method: 'GET',
          path: 'v3/application/shops/{shop_id}/transactions',
          query: { limit: '{limit}', offset: '{offset}' },
        },
        requiredScopes: ['transactions_r'],
      },
      {
        name: 'transactions.get',
        class: 'read',
        description: 'Read a single transaction (line item) by transaction_id.',
        parameters: {
          type: 'object',
          properties: {
            shop_id: { type: 'integer' },
            transaction_id: { type: 'integer' },
          },
          required: ['shop_id', 'transaction_id'],
        },
        request: { method: 'GET', path: 'v3/application/shops/{shop_id}/transactions/{transaction_id}' },
        requiredScopes: ['transactions_r'],
      },
    ],
  })
}
