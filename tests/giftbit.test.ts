import { describe, expect, it } from 'vitest'
import { giftbitConnector } from '../src/connectors/adapters/giftbit.js'

describe('giftbit adapter manifest', () => {
  it('classifies itself as the crm category and exposes the giftbit kind', () => {
    expect(giftbitConnector.manifest.kind).toBe('giftbit')
    expect(giftbitConnector.manifest.category).toBe('crm')
    expect(giftbitConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = giftbitConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the giftbit action set (rewards and brands management)', () => {
    const names = giftbitConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['rewards.send', 'rewards.get', 'rewards.list', 'brands.list'].sort())
    const reads = giftbitConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = giftbitConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['rewards.get', 'rewards.list', 'brands.list'].sort())
    expect(mutations).toEqual(['rewards.send'].sort())
  })
})
