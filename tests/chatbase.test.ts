import { describe, expect, it } from 'vitest'
import { chatbaseConnector } from '../src/connectors/adapters/chatbase.js'

describe('chatbase adapter manifest', () => {
  it('classifies itself as the crm category and exposes the chatbase kind', () => {
    expect(chatbaseConnector.manifest.kind).toBe('chatbase')
    expect(chatbaseConnector.manifest.category).toBe('crm')
    expect(chatbaseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = chatbaseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the four actions declared by the activepieces piece', () => {
    const names = chatbaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['chatbot.create', 'chatbot.list', 'conversations.search', 'chatbot.prompt'].sort(),
    )
    const reads = chatbaseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = chatbaseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['chatbot.list', 'conversations.search'].sort())
    expect(mutations).toEqual(['chatbot.create', 'chatbot.prompt'].sort())
  })
})
