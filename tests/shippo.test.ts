import { describe, expect, it } from 'vitest'
import { shippoConnector } from '../src/connectors/adapters/shippo.js'

describe('shippo adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the shippo kind', () => {
    expect(shippoConnector.manifest.kind).toBe('shippo')
    expect(shippoConnector.manifest.category).toBe('commerce')
    expect(shippoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = shippoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Shippo/i)
  })

  it('covers orders and shipping labels capability surface', () => {
    const names = shippoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['orders.create', 'orders.find', 'shippinglabels.find'].sort())
    const mutations = shippoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['orders.create'])
  })
})
