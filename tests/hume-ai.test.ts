import { describe, expect, it } from 'vitest'
import { humeAiConnector } from '../src/connectors/adapters/hume-ai.js'

describe('hume-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the hume-ai kind', () => {
    expect(humeAiConnector.manifest.kind).toBe('hume-ai')
    expect(humeAiConnector.manifest.category).toBe('other')
    expect(humeAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = humeAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Hume/i)
  })

  it('covers speech synthesis, voice management, and emotion analysis capabilities', () => {
    const names = humeAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'speech.generate',
        'speech.from-file',
        'voice.create',
        'voice.delete',
        'emotions.analyze',
        'emotions.results',
      ].sort(),
    )
  })

  it('classifies speech and emotion operations as mutations or reads', () => {
    const mutations = humeAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['speech.generate', 'speech.from-file', 'voice.create', 'voice.delete', 'emotions.analyze'].sort(),
    )

    const reads = humeAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['emotions.results'])
  })
})
