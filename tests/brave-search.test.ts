import { describe, expect, it } from 'vitest'
import { braveSearchConnector } from '../src/connectors/adapters/brave-search.js'

describe('brave-search adapter manifest', () => {
  it('exposes the brave-search kind and other category', () => {
    expect(braveSearchConnector.manifest.kind).toBe('brave-search')
    expect(braveSearchConnector.manifest.category).toBe('other')
    expect(braveSearchConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = braveSearchConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces brave web search action', () => {
    const names = braveSearchConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['brave.web.search'])
    const reads = braveSearchConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toEqual(['brave.web.search'])
  })
})
