import { describe, expect, it } from 'vitest'
import { lemonSqueezyConnector } from '../src/connectors/adapters/lemon-squeezy.js'

describe('lemon-squeezy adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the lemon-squeezy kind', () => {
    expect(lemonSqueezyConnector.manifest.kind).toBe('lemon-squeezy')
    expect(lemonSqueezyConnector.manifest.category).toBe('commerce')
    expect(lemonSqueezyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = lemonSqueezyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (products, orders, subscriptions, customers, checkout)', () => {
    const names = lemonSqueezyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'products.list',
        'orders.list',
        'orders.get',
        'subscriptions.list',
        'customers.list',
        'checkouts.create',
      ].sort(),
    )
    const reads = lemonSqueezyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = lemonSqueezyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['customers.list', 'orders.get', 'orders.list', 'products.list', 'subscriptions.list'].sort(),
    )
    expect(mutations).toEqual(['checkouts.create'])
  })
})
