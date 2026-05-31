import { describe, expect, it } from 'vitest'
import { paywhirlConnector } from '../src/connectors/adapters/paywhirl.js'

describe('paywhirl adapter manifest', () => {
  it('classifies itself as the crm category and exposes the paywhirl kind', () => {
    expect(paywhirlConnector.manifest.kind).toBe('paywhirl')
    expect(paywhirlConnector.manifest.category).toBe('crm')
    expect(paywhirlConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = paywhirlConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Paywhirl|API/i)
  })

  it('covers customer, subscription, and search capability surface', () => {
    const names = paywhirlConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'customers.create',
        'customers.get',
        'customers.search',
        'subscriptions.cancel',
        'subscriptions.create',
        'subscriptions.search',
      ].sort(),
    )
    const mutations = paywhirlConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['customers.create', 'subscriptions.cancel', 'subscriptions.create'].sort(),
    )
  })
})
