import { describe, expect, it } from 'vitest'
import { linkupConnector } from '../src/connectors/adapters/linkup.js'

describe('linkup adapter manifest', () => {
  it('classifies itself as the other category and exposes the linkup kind', () => {
    expect(linkupConnector.manifest.kind).toBe('linkup')
    expect(linkupConnector.manifest.category).toBe('other')
    expect(linkupConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = linkupConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: search and fetch', () => {
    const names = linkupConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['fetch', 'search'])
    const reads = linkupConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['fetch', 'search'])
  })
})
