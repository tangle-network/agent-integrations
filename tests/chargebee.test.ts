import { describe, expect, it } from 'vitest'
import { chargebeeConnector } from '../src/connectors/adapters/chargebee.js'

describe('chargebee adapter manifest', () => {
  it('classifies itself as the crm category and exposes the chargebee kind', () => {
    expect(chargebeeConnector.manifest.kind).toBe('chargebee')
    expect(chargebeeConnector.manifest.category).toBe('crm')
    expect(chargebeeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = chargebeeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (cancel/create subscription, create/get customer)', () => {
    const names = chargebeeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'subscription.cancel',
        'customer.create',
        'subscription.create',
        'customer.get',
      ].sort(),
    )
    const reads = chargebeeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = chargebeeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['customer.get'])
    expect(mutations).toEqual(
      ['customer.create', 'subscription.cancel', 'subscription.create'].sort(),
    )
  })
})
