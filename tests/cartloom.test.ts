import { describe, expect, it } from 'vitest'
import { cartloomConnector } from '../src/connectors/adapters/cartloom.js'

describe('cartloom adapter manifest', () => {
  it('classifies itself as the crm category and exposes the cartloom kind', () => {
    expect(cartloomConnector.manifest.kind).toBe('cartloom')
    expect(cartloomConnector.manifest.category).toBe('crm')
    expect(cartloomConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = cartloomConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: discounts and orders and products', () => {
    const names = cartloomConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'discounts.create',
      'discounts.get',
      'discounts.list',
      'orders.get',
      'orders.listByDate',
      'orders.searchByEmail',
      'products.list',
    ])
    const mutations = cartloomConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['discounts.create'])
  })
})
