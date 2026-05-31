import { describe, expect, it } from 'vitest'
import { koFiConnector } from '../src/connectors/adapters/ko-fi.js'

describe('ko-fi adapter manifest', () => {
  it('classifies itself as the crm category and exposes the ko-fi kind', () => {
    expect(koFiConnector.manifest.kind).toBe('ko-fi')
    expect(koFiConnector.manifest.category).toBe('crm')
    expect(koFiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = koFiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog trigger surface: donation, subscription, commission, shop-order', () => {
    const names = koFiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'new.donation',
        'new.subscription',
        'new.commission',
        'new.shop.order',
        'webhook.ack',
      ].sort(),
    )
    const reads = koFiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = koFiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['new.commission', 'new.donation', 'new.shop.order', 'new.subscription'].sort(),
    )
    expect(mutations).toEqual(['webhook.ack'])
  })
})
