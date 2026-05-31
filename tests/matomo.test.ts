import { describe, expect, it } from 'vitest'
import { matomoConnector } from '../src/connectors/adapters/matomo.js'

describe('matomo adapter manifest', () => {
  it('classifies itself as the database category and exposes the matomo kind', () => {
    expect(matomoConnector.manifest.kind).toBe('matomo')
    expect(matomoConnector.manifest.category).toBe('database')
    expect(matomoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = matomoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: annotations.add', () => {
    const names = matomoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['annotations.add'])
    const mutations = matomoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['annotations.add'])
  })
})
