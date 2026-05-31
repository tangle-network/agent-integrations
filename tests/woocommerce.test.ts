import { describe, expect, it } from 'vitest'
import { woocommerceConnector } from '../src/connectors/adapters/woocommerce.js'

describe('woocommerce adapter manifest', () => {
  it('classifies itself as the crm category and exposes the woocommerce kind', () => {
    expect(woocommerceConnector.manifest.kind).toBe('woocommerce')
    expect(woocommerceConnector.manifest.category).toBe('crm')
    expect(woocommerceConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth with a WooCommerce-specific hint', () => {
    const auth = woocommerceConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/WooCommerce/i)
  })

  it('covers the full activepieces action set (coupons, customers, products)', () => {
    const names = woocommerceConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'coupons.create',
        'customers.create',
        'customers.find',
        'products.create',
        'products.find',
      ].sort(),
    )
    const reads = woocommerceConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = woocommerceConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['customers.find', 'products.find'].sort())
    expect(mutations).toEqual(['coupons.create', 'customers.create', 'products.create'].sort())
  })
})
