import { describe, expect, it } from 'vitest'
import { chatlingConnector } from '../src/connectors/adapters/chatling.js'

describe('chatling adapter manifest', () => {
  it('classifies itself under the other category and exposes the chatling kind', () => {
    expect(chatlingConnector.manifest.kind).toBe('chatling')
    expect(chatlingConnector.manifest.category).toBe('other')
    expect(chatlingConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares an api-key auth surface (Chatling has no OAuth flow)', () => {
    const auth = chatlingConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
  })

  it('exposes the send.message and create.chatbot capabilities from the activepieces catalog', () => {
    const names = chatlingConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['contacts.list', 'conversations.list', 'create.chatbot', 'send.message'])

    const send = chatlingConnector.manifest.capabilities.find((c) => c.name === 'send.message')
    if (!send) throw new Error('send.message capability missing')
    expect(send.class).toBe('mutation')

    const create = chatlingConnector.manifest.capabilities.find((c) => c.name === 'create.chatbot')
    if (!create) throw new Error('create.chatbot capability missing')
    expect(create.class).toBe('mutation')
  })
})
