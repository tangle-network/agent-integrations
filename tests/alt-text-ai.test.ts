import { describe, expect, it } from 'vitest'
import { altTextAiConnector } from '../src/connectors/adapters/alt-text-ai.js'

describe('alt-text-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the alt-text-ai kind', () => {
    expect(altTextAiConnector.manifest.kind).toBe('alt-text-ai')
    expect(altTextAiConnector.manifest.category).toBe('other')
    expect(altTextAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = altTextAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the single generate-alt-text write action declared by the activepieces piece', () => {
    const names = altTextAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['images.generateAltText'])
    const reads = altTextAiConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    const mutations = altTextAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    // The upstream piece has a single risk:"write" action and no triggers.
    expect(reads).toEqual([])
    expect(mutations).toEqual(['images.generateAltText'])
  })
})
