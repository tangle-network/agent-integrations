import { describe, expect, it } from 'vitest'
import { deepgramConnector } from '../src/connectors/adapters/deepgram.js'

describe('deepgram adapter manifest', () => {
  it('classifies itself as the comms category and exposes the deepgram kind', () => {
    expect(deepgramConnector.manifest.kind).toBe('deepgram')
    expect(deepgramConnector.manifest.category).toBe('comms')
    expect(deepgramConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = deepgramConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Deepgram/i)
  })

  it('covers transcription, speech synthesis, projects, usage, and key management capabilities', () => {
    const names = deepgramConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'keys.create',
        'keys.list',
        'projects.get',
        'projects.list',
        'speak.generate',
        'transcription.create',
        'transcription.get',
        'usage.list',
      ].sort(),
    )
    const mutations = deepgramConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['keys.create', 'speak.generate', 'transcription.create'].sort(),
    )
  })
})
