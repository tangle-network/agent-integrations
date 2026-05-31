import { describe, expect, it } from 'vitest'
import { chartlyConnector } from '../src/connectors/adapters/chartly.js'

describe('chartly adapter manifest', () => {
  it('exposes the chartly kind and the other category (chartly is workflow tooling in activepieces)', () => {
    expect(chartlyConnector.manifest.kind).toBe('chartly')
    expect(chartlyConnector.manifest.category).toBe('other')
    expect(chartlyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = chartlyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (create.chart, get.chart)', () => {
    const names = chartlyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['create.chart', 'get.chart'].sort())

    const reads = chartlyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = chartlyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.chart'])
    expect(mutations).toEqual(['create.chart'])
  })
})
