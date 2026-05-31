import { describe, expect, it } from 'vitest'
import { gameballConnector } from '../src/connectors/adapters/gameball.js'

describe('gameball adapter manifest', () => {
  it('exposes the gameball kind and classifies under other', () => {
    expect(gameballConnector.manifest.kind).toBe('gameball')
    expect(gameballConnector.manifest.category).toBe('other')
    expect(gameballConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = gameballConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: send.event mutation only', () => {
    const names = gameballConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['send.event'])
    const mutations = gameballConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['send.event'])
  })
})
