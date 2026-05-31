import { describe, expect, it } from 'vitest'
import { easyPeasyAiConnector } from '../src/connectors/adapters/easy-peasy-ai.js'

describe('easy-peasy-ai adapter manifest', () => {
  it('classifies itself under other and exposes the easy-peasy-ai kind', () => {
    expect(easyPeasyAiConnector.manifest.kind).toBe('easy-peasy-ai')
    expect(easyPeasyAiConnector.manifest.category).toBe('other')
    expect(easyPeasyAiConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = easyPeasyAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: text generation, image generation, and transcription', () => {
    const names = easyPeasyAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'generator.text.run',
        'image.generate',
        'transcription.create',
        'transcription.get',
      ].sort(),
    )
    const reads = easyPeasyAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = easyPeasyAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['transcription.get'])
    expect(mutations).toEqual(
      ['generator.text.run', 'image.generate', 'transcription.create'].sort(),
    )
  })
})
