import { describe, expect, it } from 'vitest'
import { personalAiConnector } from '../src/connectors/adapters/personal-ai.js'

describe('personal-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the personal-ai kind', () => {
    expect(personalAiConnector.manifest.kind).toBe('personal-ai')
    expect(personalAiConnector.manifest.category).toBe('other')
    expect(personalAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = personalAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Personal AI/i)
  })

  it('covers memory, message, conversation, training, and document capability surface', () => {
    const names = personalAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'memory.create',
        'message.create',
        'conversation.get',
        'training.create',
        'document.get',
        'document.upload',
        'document.update',
      ].sort(),
    )
    const mutations = personalAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'memory.create',
        'message.create',
        'training.create',
        'document.upload',
        'document.update',
      ].sort(),
    )
  })
})
