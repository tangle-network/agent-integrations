import { describe, expect, it } from 'vitest'
import { gammaConnector } from '../src/connectors/adapters/gamma.js'

describe('gamma adapter manifest', () => {
  it('classifies itself as the other category and exposes the gamma kind', () => {
    expect(gammaConnector.manifest.kind).toBe('gamma')
    expect(gammaConnector.manifest.category).toBe('other')
    expect(gammaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = gammaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Gamma/i)
  })

  it('covers content generation and generation status capability surface', () => {
    const names = gammaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['content.generate', 'generation.status'].sort())
    const mutations = gammaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toEqual(['content.generate'])
  })
})
