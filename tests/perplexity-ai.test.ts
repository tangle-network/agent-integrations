import { describe, expect, it } from 'vitest'
import { perplexityAiConnector } from '../src/connectors/adapters/perplexity-ai.js'

describe('perplexity-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the perplexity-ai kind', () => {
    expect(perplexityAiConnector.manifest.kind).toBe('perplexity-ai')
    expect(perplexityAiConnector.manifest.category).toBe('other')
    expect(perplexityAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = perplexityAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Perplexity/i)
  })

  it('covers the chat completion capability', () => {
    const names = perplexityAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['chat.create-completion'])
    const mutations = perplexityAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['chat.create-completion'])
  })
})
