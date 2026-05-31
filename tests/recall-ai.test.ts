import { describe, expect, it } from 'vitest'
import { recallAiConnector } from '../src/connectors/adapters/recall-ai.js'

describe('recall-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the recall-ai kind', () => {
    expect(recallAiConnector.manifest.kind).toBe('recall-ai')
    expect(recallAiConnector.manifest.category).toBe('comms')
    expect(recallAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = recallAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Recall/i)
  })

  it('covers the bots and messages capability surface', () => {
    const names = recallAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['bots.create', 'bots.retrieve', 'messages.send'].sort())
    const mutations = recallAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['bots.create', 'messages.send'].sort())
  })
})
