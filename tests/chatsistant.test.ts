import { describe, expect, it } from 'vitest'
import { chatsistantConnector } from '../src/connectors/adapters/chatsistant.js'

describe('chatsistant adapter manifest', () => {
  it('classifies itself as the comms category and exposes the chatsistant kind', () => {
    expect(chatsistantConnector.manifest.kind).toBe('chatsistant')
    expect(chatsistantConnector.manifest.category).toBe('comms')
    expect(chatsistantConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = chatsistantConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: sending a message', () => {
    const names = chatsistantConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['message.send'])
    const mutations = chatsistantConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['message.send'])
  })
})
