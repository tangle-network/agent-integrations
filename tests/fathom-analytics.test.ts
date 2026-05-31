import { describe, expect, it } from 'vitest'
import { fathomAnalyticsConnector } from '../src/connectors/adapters/fathom-analytics.js'

describe('fathom-analytics adapter manifest', () => {
  it('exposes the fathom-analytics kind with an authoritative consistency model', () => {
    expect(fathomAnalyticsConnector.manifest.kind).toBe('fathom-analytics')
    expect(fathomAnalyticsConnector.manifest.category).toBe('other')
    expect(fathomAnalyticsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = fathomAnalyticsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: list/get sites, list/create events, get aggregation', () => {
    const names = fathomAnalyticsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'list.sites',
        'get.site',
        'create.event',
        'list.events',
        'get.aggregation',
      ].sort(),
    )
    const reads = fathomAnalyticsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = fathomAnalyticsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.aggregation', 'get.site', 'list.events', 'list.sites'])
    expect(mutations).toEqual(['create.event'])
  })
})
