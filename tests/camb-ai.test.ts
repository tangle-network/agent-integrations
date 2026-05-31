import { describe, expect, it } from 'vitest'
import { cambAiConnector } from '../src/connectors/adapters/camb-ai.js'

describe('camb-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the camb-ai kind', () => {
    expect(cambAiConnector.manifest.kind).toBe('camb-ai')
    expect(cambAiConnector.manifest.category).toBe('other')
    expect(cambAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = cambAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (text-to-sound, text-to-speech, transcription, translation)', () => {
    const names = cambAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'audio.textToSound',
        'audio.textToSpeech',
        'audio.transcribe',
        'text.translate',
      ].sort(),
    )
    const mutations = cambAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'audio.textToSound',
        'audio.textToSpeech',
        'audio.transcribe',
        'text.translate',
      ].sort(),
    )
  })
})
