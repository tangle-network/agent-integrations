import { describe, expect, it } from 'vitest'
import { googleGeminiConnector } from '../src/connectors/adapters/google-gemini.js'

describe('google-gemini adapter manifest', () => {
  it('classifies itself as the other category and exposes the google-gemini kind', () => {
    expect(googleGeminiConnector.manifest.kind).toBe('google-gemini')
    expect(googleGeminiConnector.manifest.category).toBe('other')
    expect(googleGeminiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = googleGeminiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Gemini/i)
  })

  it('covers the content generation, chat, and media capability surface', () => {
    const names = googleGeminiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'models.list',
        'chat.generate',
        'content.generate',
        'video.generate',
        'image.generateFromImage',
        'search.generateWithFile',
        'audio.textToSpeech',
      ].sort(),
    )
    const mutations = googleGeminiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'chat.generate',
        'content.generate',
        'video.generate',
        'image.generateFromImage',
        'audio.textToSpeech',
      ].sort(),
    )
  })
})
