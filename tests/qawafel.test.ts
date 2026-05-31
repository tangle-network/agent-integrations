import { describe, expect, it } from 'vitest'
import { qawafelConnector } from '../src/connectors/adapters/qawafel.js'

describe('qawafel adapter manifest', () => {
  it('classifies itself as the crm category and exposes the qawafel kind', () => {
    expect(qawafelConnector.manifest.kind).toBe('qawafel')
    expect(qawafelConnector.manifest.category).toBe('crm')
    expect(qawafelConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = qawafelConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Qawafel/i)
  })

  it('covers products, orders, merchants, and invoices capability surface', () => {
    const names = qawafelConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'products.create',
        'products.update',
        'products.get',
        'products.list',
        'orders.create',
        'orders.updateStatus',
        'orders.cancel',
        'orders.get',
        'orders.list',
        'merchants.create',
        'invoices.create',
        'invoices.get',
        'invoices.list',
      ].sort(),
    )
    const mutations = qawafelConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'products.create',
        'products.update',
        'orders.create',
        'orders.updateStatus',
        'orders.cancel',
        'merchants.create',
        'invoices.create',
      ].sort(),
    )
  })
})
