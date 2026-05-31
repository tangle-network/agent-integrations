import { describe, expect, it } from 'vitest'
import { chatDataConnector } from '../src/connectors/adapters/chat-data.js'

describe('chat-data adapter manifest', () => {
  it('classifies itself as the comms category and exposes the chat-data kind', () => {
    expect(chatDataConnector.manifest.kind).toBe('chat-data')
    // Catalog `category` is "chat"; closest concept in our enum is `comms`.
    expect(chatDataConnector.manifest.category).toBe('comms')
    expect(chatDataConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = chatDataConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the six write actions declared by the activepieces piece', () => {
    const names = chatDataConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'chatbot.create',
        'chatbot.delete',
        'chatbot.send_message',
        'chatbot.update_base_prompt',
        'chatbot.retrain',
        'chatbot.upload_file',
      ].sort(),
    )
    const reads = chatDataConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    const mutations = chatDataConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    // Every activepieces chat-data action is risk:"write" or "destructive" — there are no reads.
    expect(reads).toEqual([])
    expect(mutations).toEqual(
      [
        'chatbot.create',
        'chatbot.delete',
        'chatbot.send_message',
        'chatbot.update_base_prompt',
        'chatbot.retrain',
        'chatbot.upload_file',
      ].sort(),
    )
  })
})
