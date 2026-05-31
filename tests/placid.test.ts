import { describe, expect, it } from 'vitest'
import { placidConnector } from '../src/connectors/adapters/placid.js'

describe('placid adapter manifest', () => {
  it('classifies itself as the storage category and exposes the placid kind', () => {
    expect(placidConnector.manifest.kind).toBe('placid')
    expect(placidConnector.manifest.category).toBe('storage')
    expect(placidConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = placidConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: create image/pdf/video, get image/pdf/video, convert file, and list templates', () => {
    const names = placidConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'images.create',
        'images.get',
        'pdfs.create',
        'pdfs.get',
        'videos.create',
        'videos.get',
        'files.convert',
        'templates.list',
      ].sort(),
    )
    const mutations = placidConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['images.create', 'pdfs.create', 'videos.create', 'files.convert'].sort(),
    )
  })
})
