import { describe, expect, it } from 'vitest'
import { vtexConnector } from '../src/connectors/adapters/vtex.js'

describe('vtex adapter manifest', () => {
  it('classifies itself as the crm category and exposes the vtex kind', () => {
    expect(vtexConnector.manifest.kind).toBe('vtex')
    expect(vtexConnector.manifest.category).toBe('crm')
    expect(vtexConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = vtexConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/VTEX|App|Token/i)
  })

  it('covers brands, products, categories, skus, orders, and clients capability surface', () => {
    const names = vtexConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'brands.create',
        'brands.delete',
        'brands.get',
        'brands.list',
        'brands.update',
        'categories.get',
        'clients.get',
        'clients.list',
        'orders.get',
        'orders.list',
        'products.create',
        'products.get',
        'products.update',
        'skus.create',
        'skus.list',
      ].sort(),
    )
    const mutations = vtexConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'brands.create',
        'brands.delete',
        'brands.update',
        'products.create',
        'products.update',
        'skus.create',
      ].sort(),
    )
  })
})
