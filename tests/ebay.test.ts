import { describe, expect, it } from 'vitest'
import { ebayConnector } from '../src/connectors/adapters/ebay.js'

describe('ebay adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the ebay kind', () => {
    expect(ebayConnector.manifest.kind).toBe('ebay')
    expect(ebayConnector.manifest.category).toBe('commerce')
    expect(ebayConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the real eBay authorize / token endpoints and env-var names', () => {
    const auth = ebayConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://auth.ebay.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://api.ebay.com/identity/v1/oauth2/token')
    expect(auth.clientIdEnv).toBe('EBAY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('EBAY_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining([
        'https://api.ebay.com/oauth/api_scope',
        'https://api.ebay.com/oauth/api_scope/sell.inventory',
        'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
        'https://api.ebay.com/oauth/api_scope/sell.account',
        'https://api.ebay.com/oauth/api_scope/sell.marketing',
        'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
      ]),
    )
  })

  it('covers inventory-item, offer, fulfillment-order, and identity capabilities', () => {
    const names = ebayConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'inventory_items.search',
        'inventory_items.get',
        'inventory_items.upsert',
        'inventory_items.delete',
        'offers.search',
        'offers.publish',
        'orders.search',
        'orders.get',
        'orders.ship',
        'identity.get',
      ].sort(),
    )
    const reads = ebayConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = ebayConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'inventory_items.search',
        'inventory_items.get',
        'offers.search',
        'orders.search',
        'orders.get',
        'identity.get',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'inventory_items.upsert',
        'inventory_items.delete',
        'offers.publish',
        'orders.ship',
      ].sort(),
    )
  })

  it('requires the matching sell.* scope on each mutation capability', () => {
    const mutations = ebayConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const cap of mutations) {
      expect(cap.requiredScopes).toBeDefined()
      expect(cap.requiredScopes!.length).toBeGreaterThan(0)
      const scope = cap.requiredScopes![0]
      expect(scope.startsWith('https://api.ebay.com/oauth/api_scope/sell.')).toBe(true)
    }
  })
})
