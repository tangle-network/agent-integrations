import { describe, expect, it } from 'vitest'
import { chatnodeConnector } from '../src/connectors/adapters/chatnode.js'

describe('chatnode adapter manifest', () => {
  it('classifies itself as the other category and exposes the chatnode kind', () => {
    expect(chatnodeConnector.manifest.kind).toBe('chatnode')
    expect(chatnodeConnector.manifest.category).toBe('other')
    expect(chatnodeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = chatnodeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the single ask-chatbot action declared by the activepieces piece', () => {
    const names = chatnodeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['chatbot.ask'])
    const reads = chatnodeConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    const mutations = chatnodeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    // The upstream activepieces action `askChatbotAction` is risk:"write"
    // because each call appends to the persisted chat-session transcript.
    expect(reads).toEqual([])
    expect(mutations).toEqual(['chatbot.ask'])
  })
})
