import { describe, expect, it } from 'vitest'
import { shopifyConnector } from '../src/connectors/adapters/shopify.js'

describe('shopify adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the shopify kind', () => {
    expect(shopifyConnector.manifest.kind).toBe('shopify')
    expect(shopifyConnector.manifest.category).toBe('commerce')
    expect(shopifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the per-shop authorize / token endpoint templates and env-var names', () => {
    const auth = shopifyConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://{shop}.myshopify.com/admin/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://{shop}.myshopify.com/admin/oauth/access_token')
    expect(auth.clientIdEnv).toBe('SHOPIFY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('SHOPIFY_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining([
        'read_products',
        'write_products',
        'read_orders',
        'write_orders',
        'read_customers',
        'write_customers',
        'read_inventory',
        'write_inventory',
      ]),
    )
  })

  it('covers products, orders, customers, and inventory-level capabilities', () => {
    const names = shopifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'products.search',
        'products.get',
        'products.create',
        'products.update',
        'products.delete',
        'orders.search',
        'orders.get',
        'orders.update',
        'orders.cancel',
        'customers.search',
        'customers.get',
        'customers.create',
        'customers.update',
        'inventory_levels.list',
        'inventory_levels.set',
        'inventory_levels.adjust',
      ].sort(),
    )
    const reads = shopifyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = shopifyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'products.search',
        'products.get',
        'orders.search',
        'orders.get',
        'customers.search',
        'customers.get',
        'inventory_levels.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'products.create',
        'products.update',
        'products.delete',
        'orders.update',
        'orders.cancel',
        'customers.create',
        'customers.update',
        'inventory_levels.set',
        'inventory_levels.adjust',
      ].sort(),
    )
  })
})
