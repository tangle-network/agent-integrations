import { describe, expect, it } from 'vitest'
import { runwareConnector } from '../src/connectors/adapters/runware.js'

describe('runware adapter manifest', () => {
  it('classifies itself as other and exposes the runware kind', () => {
    expect(runwareConnector.manifest.kind).toBe('runware')
    expect(runwareConnector.manifest.category).toBe('other')
    expect(runwareConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = runwareConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set', () => {
    const names = runwareConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'image.remove-background',
      'images.generate.from-image',
      'images.generate.from-text',
      'video.generate.from-text',
    ])
    const mutations = runwareConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual([
      'image.remove-background',
      'images.generate.from-image',
      'images.generate.from-text',
      'video.generate.from-text',
    ])
  })
})
