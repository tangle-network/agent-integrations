import { describe, expect, it } from 'vitest'
import { leexiConnector } from '../src/connectors/adapters/leexi.js'

describe('leexi adapter manifest', () => {
  it('exposes the leexi kind under the other category', () => {
    expect(leexiConnector.manifest.kind).toBe('leexi')
    expect(leexiConnector.manifest.category).toBe('other')
    expect(leexiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = leexiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: get call', () => {
    const names = leexiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['calls.get'])
    const reads = leexiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['calls.get'])
  })
})
