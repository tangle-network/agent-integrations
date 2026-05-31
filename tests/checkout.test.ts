import { describe, expect, it } from 'vitest'
import { checkoutConnector } from '../src/connectors/adapters/checkout.js'

describe('checkout adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the checkout kind', () => {
    expect(checkoutConnector.manifest.kind).toBe('checkout')
    expect(checkoutConnector.manifest.category).toBe('commerce')
    expect(checkoutConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = checkoutConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: customer CRUD, payment links, payouts, refunds, and lookups', () => {
    const names = checkoutConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'create.customer',
        'update.customer',
        'create.payment.link',
        'create.payout',
        'refund.payment',
        'get.payment.details',
        'get.payment.actions',
      ].sort(),
    )
    const reads = checkoutConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = checkoutConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.payment.actions', 'get.payment.details'])
    expect(mutations).toEqual(
      [
        'create.customer',
        'create.payment.link',
        'create.payout',
        'refund.payment',
        'update.customer',
      ].sort(),
    )
  })
})
