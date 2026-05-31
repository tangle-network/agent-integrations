import { describe, expect, it } from 'vitest'
import { cashfreePaymentsConnector } from '../src/connectors/adapters/cashfree-payments.js'

describe('cashfree-payments adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the cashfree-payments kind', () => {
    expect(cashfreePaymentsConnector.manifest.kind).toBe('cashfree-payments')
    expect(cashfreePaymentsConnector.manifest.category).toBe('commerce')
    expect(cashfreePaymentsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = cashfreePaymentsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: orders + links + refunds + cashgrams', () => {
    const names = cashfreePaymentsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'cashgrams.create',
        'cashgrams.deactivate',
        'orders.create',
        'orders.refunds.list',
        'payment_links.cancel',
        'payment_links.create',
        'payment_links.get',
        'payment_links.orders.list',
        'refunds.create',
      ].sort(),
    )
    const reads = cashfreePaymentsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = cashfreePaymentsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['orders.refunds.list', 'payment_links.get', 'payment_links.orders.list'])
    expect(mutations).toEqual(
      [
        'cashgrams.create',
        'cashgrams.deactivate',
        'orders.create',
        'payment_links.cancel',
        'payment_links.create',
        'refunds.create',
      ].sort(),
    )
  })
})
