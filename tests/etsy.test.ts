import { describe, expect, it } from 'vitest'
import { etsyConnector } from '../src/connectors/adapters/etsy.js'

const TEST_KEYSTRING = 'test-keystring-abc123'

describe('etsy adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the etsy kind', () => {
    const c = etsyConnector({ keystring: TEST_KEYSTRING })
    expect(c.manifest.kind).toBe('etsy')
    expect(c.manifest.category).toBe('commerce')
    expect(c.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the real Etsy v3 authorize / token endpoints and env-var names', () => {
    const auth = etsyConnector({ keystring: TEST_KEYSTRING }).manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://www.etsy.com/oauth/connect')
    expect(auth.tokenUrl).toBe('https://api.etsy.com/v3/public/oauth/token')
    expect(auth.clientIdEnv).toBe('ETSY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('ETSY_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining([
        'listings_r',
        'listings_w',
        'listings_d',
        'transactions_r',
        'transactions_w',
        'shops_r',
        'shops_w',
        'profile_r',
        'email_r',
      ]),
    )
  })

  it('rejects construction without a keystring (x-api-key is mandatory on every request)', () => {
    // @ts-expect-error — exercising runtime guard for missing required option
    expect(() => etsyConnector({})).toThrow(/keystring is required/)
    expect(() => etsyConnector({ keystring: '' })).toThrow(/keystring is required/)
  })

  it('covers users, shops, listings, receipts, and transactions capabilities', () => {
    const names = etsyConnector({ keystring: TEST_KEYSTRING })
      .manifest.capabilities.map((c) => c.name)
      .sort()
    expect(names).toEqual(
      [
        'users.me',
        'shops.get_for_user',
        'shops.get',
        'shops.update',
        'listings.search',
        'listings.get',
        'listings.create',
        'listings.update',
        'listings.delete',
        'receipts.search',
        'receipts.get',
        'receipts.update',
        'receipts.create_shipment',
        'transactions.search',
        'transactions.get',
      ].sort(),
    )

    const caps = etsyConnector({ keystring: TEST_KEYSTRING }).manifest.capabilities
    const reads = caps.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = caps.filter((c) => c.class === 'mutation').map((c) => c.name).sort()

    expect(reads).toEqual(
      [
        'users.me',
        'shops.get_for_user',
        'shops.get',
        'listings.search',
        'listings.get',
        'receipts.search',
        'receipts.get',
        'transactions.search',
        'transactions.get',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'shops.update',
        'listings.create',
        'listings.update',
        'listings.delete',
        'receipts.update',
        'receipts.create_shipment',
      ].sort(),
    )
  })

  it('pins every write capability to a write-class scope (listings_w / shops_w / transactions_w / listings_d)', () => {
    const caps = etsyConnector({ keystring: TEST_KEYSTRING }).manifest.capabilities
    const writeScopeByCap: Record<string, string> = {
      'shops.update': 'shops_w',
      'listings.create': 'listings_w',
      'listings.update': 'listings_w',
      'listings.delete': 'listings_d',
      'receipts.update': 'transactions_w',
      'receipts.create_shipment': 'transactions_w',
    }
    for (const [name, expectedScope] of Object.entries(writeScopeByCap)) {
      const cap = caps.find((c) => c.name === name)
      expect(cap, `${name} must exist`).toBeDefined()
      expect(cap?.requiredScopes, `${name} must require ${expectedScope}`).toContain(expectedScope)
    }
  })
})
