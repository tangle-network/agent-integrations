import { describe, expect, it } from 'vitest'
import { dittofeedConnector } from '../src/connectors/adapters/dittofeed.js'

describe('dittofeed adapter manifest', () => {
  it('classifies itself as the crm category and exposes the dittofeed kind', () => {
    expect(dittofeedConnector.manifest.kind).toBe('dittofeed')
    expect(dittofeedConnector.manifest.category).toBe('crm')
    expect(dittofeedConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = dittofeedConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: identify, track, and screen', () => {
    const names = dittofeedConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['events.track', 'screens.record', 'users.identify'])
    const mutations = dittofeedConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['events.track', 'screens.record', 'users.identify'])
  })
})
