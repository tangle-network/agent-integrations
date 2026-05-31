import { describe, expect, it } from 'vitest'
import { mixpanelConnector } from '../src/connectors/adapters/mixpanel.js'

describe('mixpanel adapter manifest', () => {
  it('classifies itself as the database category and exposes the mixpanel kind', () => {
    expect(mixpanelConnector.manifest.kind).toBe('mixpanel')
    expect(mixpanelConnector.manifest.category).toBe('database')
    expect(mixpanelConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = mixpanelConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog track event action and matching query reads', () => {
    const names = mixpanelConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'events.track',
        'profiles.set',
        'events.export',
        'events.segmentation',
        'profiles.query',
      ].sort(),
    )
    const mutations = mixpanelConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['events.track', 'profiles.set'].sort())
    const reads = mixpanelConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['events.export', 'events.segmentation', 'profiles.query'].sort())
  })
})
