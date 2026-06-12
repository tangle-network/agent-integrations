/**
 * Delegated-tool bridge — the pattern where an external stateful agent (a voice
 * caller, a long-running autonomous worker) is handed a leased, scoped, TTL'd
 * token and calls BACK into the product's tools mid-session.
 *
 * The loop: product mints a scoped token over an explicit tool allow-list →
 * packages it as a lease → hands it to the external agent → external agent calls
 * the product's JSON-RPC callback endpoint with the bearer → product verifies
 * (fresh, allow-listed, integration connected) → invokes the tool → returns the
 * result. The product's connector credentials never leave the product.
 */

export * from './token.js'
export * from './handler.js'
export * from './lease.js'
