import { describe, expect, it } from 'vitest'
import { chatAidConnector } from '../src/connectors/adapters/chat-aid.js'

describe('chat-aid adapter manifest', () => {
  it('classifies itself as the other category and exposes the chat-aid kind', () => {
    expect(chatAidConnector.manifest.kind).toBe('chat-aid')
    expect(chatAidConnector.manifest.category).toBe('other')
    expect(chatAidConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = chatAidConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Chat Aid/i)
  })

  it('covers sources, questions, and knowledge base capability surfaces', () => {
    const names = chatAidConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['questions.ask', 'sources.add', 'sources.get'].sort())
    const mutations = chatAidConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['questions.ask', 'sources.add'].sort())
  })
})
