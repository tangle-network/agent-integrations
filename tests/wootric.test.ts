import { describe, expect, it } from 'vitest'
import { wootricConnector } from '../src/connectors/adapters/wootric.js'

describe('wootric adapter manifest', () => {
  it('classifies itself as the other category and exposes the wootric kind', () => {
    expect(wootricConnector.manifest.kind).toBe('wootric')
    expect(wootricConnector.manifest.category).toBe('other')
    expect(wootricConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = wootricConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set: creating surveys', () => {
    const names = wootricConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['surveys.create'])
    const mutations = wootricConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['surveys.create'])
  })
})
