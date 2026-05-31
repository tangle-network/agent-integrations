import { describe, expect, it } from 'vitest'
import { dappierConnector } from '../src/connectors/adapters/dappier.js'

describe('dappier adapter manifest', () => {
  it('classifies itself as the other category and exposes the dappier kind', () => {
    expect(dappierConnector.manifest.kind).toBe('dappier')
    expect(dappierConnector.manifest.category).toBe('other')
    expect(dappierConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = dappierConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (real time web search, sports news, stock market data, lifestyle news)', () => {
    const names = dappierConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'search.realTimeWeb',
        'search.sportsNews',
        'search.stockMarketData',
        'search.lifestyleNews',
      ].sort(),
    )
    const reads = dappierConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'search.realTimeWeb',
        'search.sportsNews',
        'search.stockMarketData',
        'search.lifestyleNews',
      ].sort(),
    )
  })
})
