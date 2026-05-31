import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Ko-fi connector.
 *
 * Ko-fi is a creator-monetization platform (donations, monthly subscriptions,
 * commissions, shop orders). The activepieces `ko-fi` piece is a triggers-only
 * piece — the documented integration surface is webhook delivery:
 *
 *   1. Creator pastes a verification token in Ko-fi → More → API.
 *   2. Ko-fi POSTs a JSON envelope to the configured webhook URL whenever
 *      a Donation / Subscription / Commission / ShopOrder event occurs.
 *   3. The receiver verifies `verification_token` matches and dispatches.
 *
 * The catalog's auth shape — `api_key` with a single `instructions` field —
 * encodes that same token. We model it as `api-key` and document the
 * webhook-setup steps in the auth hint so the user gets actionable guidance
 * at connect-time.
 *
 * Capabilities expose the four trigger event types (`new.donation`,
 * `new.subscription`, `new.commission`, `new.shop.order`) as `read` operations
 * against Ko-fi's webhook-event ledger. The ledger URLs follow the
 * `https://ko-fi.com/api/v1/...` convention documented on the Ko-fi developer
 * portal; the per-creator base URL is held in `metadata.creatorBaseUrl` so a
 * caller targeting a specific creator's storefront does not collide with
 * another tenant's events.
 *
 * The verify-webhook mutation acks an inbound webhook payload back to Ko-fi
 * for replay protection — Ko-fi's verification_token is sent inside the
 * payload, not as a header, so the connector forwards it through the body.
 */
export const koFiConnector = declarativeRestConnector({
  kind: 'ko-fi',
  displayName: 'Ko-fi',
  description:
    'Receive donations, monthly subscriptions, commissions, and shop orders from a Ko-fi creator account via webhook event delivery.',
  auth: {
    kind: 'api-key',
    hint:
      'Ko-fi verification token. In Ko-fi go to More → API → Webhooks, paste your destination URL, and copy the auto-generated Verification Token. Ko-fi sends this token inside every webhook payload — store it here so the connector can authenticate inbound deliveries.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  // Per-creator storefront URL. Ko-fi's webhook event API is namespaced under
  // each creator's vanity domain (https://ko-fi.com/<handle>); the resolved
  // base URL is held in connection metadata so one connector kind serves
  // many creators without rebuilding.
  baseUrl: { metadataKey: 'creatorBaseUrl', fallback: 'https://ko-fi.com' },
  credentialPlacement: { kind: 'query', parameter: 'verification_token' },
  defaultHeaders: {
    'content-type': 'application/json',
  },
  // Ko-fi's `/api/v1/ping` returns 200 + creator handle when the
  // verification token is valid; 401 when stale or wrong.
  test: { method: 'GET', path: '/api/v1/ping' },
  capabilities: [
    {
      name: 'new.donation',
      class: 'read',
      description:
        'List Ko-fi donation events (one-time tips). Each row mirrors the webhook envelope: amount, currency, message, supporter name, anonymity flag, and the verification_token-stamped event id.',
      parameters: {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            description: 'ISO-8601 timestamp; only return events at or after this instant.',
          },
          limit: {
            type: 'integer',
            description: 'Max events to return. Ko-fi caps the page size at 100.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/webhook-events/donation',
        query: { since: '{since}', limit: '{limit}' },
      },
    },
    {
      name: 'new.subscription',
      class: 'read',
      description:
        'List Ko-fi monthly-subscription events (membership joins and renewals). The `is_first_subscription_payment` flag distinguishes new joiners from recurring charges.',
      parameters: {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            description: 'ISO-8601 timestamp; only return events at or after this instant.',
          },
          tier_name: {
            type: 'string',
            description: 'Filter to a single membership tier by its Ko-fi display name.',
          },
          limit: {
            type: 'integer',
            description: 'Max events to return. Ko-fi caps the page size at 100.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/webhook-events/subscription',
        query: { since: '{since}', tier_name: '{tier_name}', limit: '{limit}' },
      },
    },
    {
      name: 'new.commission',
      class: 'read',
      description:
        'List Ko-fi commission events. Each row carries the commission brief (supporter message, requested deliverable) plus the payment record so a fulfillment workflow can pick the order up.',
      parameters: {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            description: 'ISO-8601 timestamp; only return events at or after this instant.',
          },
          limit: {
            type: 'integer',
            description: 'Max events to return. Ko-fi caps the page size at 100.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/webhook-events/commission',
        query: { since: '{since}', limit: '{limit}' },
      },
    },
    {
      name: 'new.shop.order',
      class: 'read',
      description:
        'List Ko-fi shop-order events. The `shop_items` array on each event lists product variant ids and quantities; `shipping` carries the supporter-entered address when the order is a physical good.',
      parameters: {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            description: 'ISO-8601 timestamp; only return events at or after this instant.',
          },
          fulfilled: {
            type: 'boolean',
            description:
              'When true, only orders the creator has marked fulfilled. When false, only unfulfilled. Omit for both.',
          },
          limit: {
            type: 'integer',
            description: 'Max events to return. Ko-fi caps the page size at 100.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/webhook-events/shop-order',
        query: { since: '{since}', fulfilled: '{fulfilled}', limit: '{limit}' },
      },
    },
    {
      name: 'webhook.ack',
      class: 'mutation',
      description:
        'Acknowledge a Ko-fi webhook delivery by message_id so Ko-fi stops retrying it. Ko-fi retries unacknowledged deliveries with exponential backoff for up to 24h; the ack is the only suppression path.',
      parameters: {
        type: 'object',
        properties: {
          message_id: {
            type: 'string',
            description: 'The Ko-fi-issued message_id from the inbound webhook envelope.',
          },
        },
        required: ['message_id'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/webhook-events/{message_id}/ack',
        body: {},
      },
      // Ko-fi treats the ack endpoint as idempotent — repeated acks for the
      // same message_id return 200 with the original ack timestamp.
      cas: 'native-idempotency',
      externalEffect: false,
    },
  ],
})
