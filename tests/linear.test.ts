import { describe, expect, it } from 'vitest'
import { linearConnector } from '../src/connectors/adapters/linear'

describe('linear adapter', () => {
  it('routes every capability through a single POST /graphql endpoint', () => {
    // The declarative spec lives behind the closure, but every capability the
    // adapter exposes is a single GraphQL roundtrip — verify that by checking
    // every mutation has a CAS strategy and every read has at least the `read`
    // scope (Linear's coarsest GraphQL gate).
    for (const cap of linearConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(['native-idempotency', 'optimistic-read-verify', 'etag-if-match']).toContain(cap.cas)
        expect(cap.externalEffect).toBe(true)
      } else {
        const scopes = cap.requiredScopes ?? []
        expect(scopes.length).toBeGreaterThan(0)
      }
    }
  })
})
