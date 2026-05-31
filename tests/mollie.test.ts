import { describe, expect, it } from 'vitest'
import { mollieConnector } from '../src/connectors/adapters/mollie.js'

describe('mollie adapter manifest', () => {
  it('classifies itself as the crm category and exposes the mollie kind', () => {
    expect(mollieConnector.manifest.kind).toBe('mollie')
    expect(mollieConnector.manifest.category).toBe('crm')
    expect(mollieConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = mollieConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (customers, orders, payments, refunds, payment links)', () => {
    const names = mollieConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'customers.create',
        'customers.search',
        'orders.create',
        'orders.search',
        'payments.create',
        'payments.search',
        'refunds.create',
        'paymentlinks.create',
      ].sort(),
    )
    const reads = mollieConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = mollieConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['customers.search', 'orders.search', 'payments.search'].sort())
    expect(mutations).toEqual(
      [
        'customers.create',
        'orders.create',
        'payments.create',
        'refunds.create',
        'paymentlinks.create',
      ].sort(),
    )
  })
})
