import { describe, expect, it } from 'vitest'
import { serpstatConnector } from '../src/connectors/adapters/serpstat.js'

describe('serpstat adapter manifest', () => {
  it('classifies itself as the doc category and exposes the serpstat kind', () => {
    expect(serpstatConnector.manifest.kind).toBe('serpstat')
    expect(serpstatConnector.manifest.category).toBe('doc')
    expect(serpstatConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = serpstatConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Serpstat/i)
  })

  it('covers keyword and suggestion capabilities', () => {
    const names = serpstatConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['keywords.get', 'keywords.suggestions'].sort())
    const reads = serpstatConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['keywords.get', 'keywords.suggestions'].sort())
  })
})
