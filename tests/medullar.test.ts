import { describe, expect, it } from 'vitest'
import { medullarConnector } from '../src/connectors/adapters/medullar.js'

describe('medullar adapter manifest', () => {
  it('classifies itself as the other category and exposes the medullar kind', () => {
    expect(medullarConnector.manifest.kind).toBe('medullar')
    expect(medullarConnector.manifest.category).toBe('other')
    expect(medullarConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = medullarConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Medullar/i)
  })

  it('covers spaces and records capability surface', () => {
    const names = medullarConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'ask.space',
        'records.add',
        'spaces.create',
        'spaces.delete',
        'spaces.list',
        'spaces.rename',
      ].sort(),
    )
    const mutations = medullarConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'ask.space',
        'records.add',
        'spaces.create',
        'spaces.delete',
        'spaces.rename',
      ].sort(),
    )
  })
})
