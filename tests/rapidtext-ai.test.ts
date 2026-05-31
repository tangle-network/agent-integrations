import { describe, expect, it } from 'vitest'
import { rapidtextAiConnector } from '../src/connectors/adapters/rapidtext-ai.js'

describe('rapidtext-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the rapidtext-ai kind', () => {
    expect(rapidtextAiConnector.manifest.kind).toBe('rapidtext-ai')
    expect(rapidtextAiConnector.manifest.category).toBe('other')
    expect(rapidtextAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = rapidtextAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/RapidText/i)
  })

  it('covers the article generation and prompt sending capability surface', () => {
    const names = rapidtextAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['article.generate', 'prompt.send'].sort())
    const mutations = rapidtextAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['article.generate', 'prompt.send'].sort())
  })
})
