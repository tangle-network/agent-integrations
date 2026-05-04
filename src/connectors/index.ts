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
 * etc.) consume these primitives. They land in a follow-up PR (see
 * "Phase 1b" in https://github.com/tangle-network/agent-integrations
 * roadmap).
 */

export * from './types.js'
export * from './oauth.js'
export * from './webhooks.js'
export * from './adapters/index.js'
