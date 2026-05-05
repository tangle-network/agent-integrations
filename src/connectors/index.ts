/**
 * Connector primitives: contracts, OAuth helpers, signature verifiers.
 *
 * This namespace contains the substrate every Tangle product builds on
 * when implementing first-party adapters: the ConnectorAdapter contract
 * (manifest + read/mutation execution + signature/event hooks),
 * generic OAuth machinery (PKCE, state, refresh), and pure-function
 * webhook signature verifiers (Stripe, Slack, generic HMAC).
 *
 * Concrete adapter implementations (Google Calendar, HubSpot, Stripe,
 * etc.) consume these primitives and are exported from `adapters/index.ts`.
 */

export * from './types.js'
export * from './oauth.js'
export * from './webhooks.js'
export * from './adapters/index.js'
