import { describe, expect, it } from 'vitest'
import { saleorConnector } from '../src/connectors/adapters/saleor.js'

describe('saleor adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the saleor kind', () => {
    expect(saleorConnector.manifest.kind).toBe('saleor')
    expect(saleorConnector.manifest.category).toBe('commerce')
    expect(saleorConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = saleorConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Saleor/i)
  })

  it('covers graphql query, orders retrieval, and note mutation capabilities', () => {
    const names = saleorConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['graphql.query', 'orders.addNote', 'orders.get'].sort())
    const mutations = saleorConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['orders.addNote'].sort())
  })
})
