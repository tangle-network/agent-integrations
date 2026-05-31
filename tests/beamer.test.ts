import { describe, expect, it } from 'vitest'
import { beamerConnector } from '../src/connectors/adapters/beamer.js'

describe('beamer adapter manifest', () => {
  it('classifies itself as the doc category and exposes the beamer kind', () => {
    expect(beamerConnector.manifest.kind).toBe('beamer')
    expect(beamerConnector.manifest.category).toBe('doc')
    expect(beamerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = beamerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: createComment + createNewFeatureRequest + createBeamerPost + createVote', () => {
    const mutations = beamerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'comments.create',
        'featureRequests.create',
        'posts.create',
        'votes.create',
      ].sort(),
    )
    const reads = beamerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('posts.query')
    expect(reads).toContain('featureRequests.query')
  })
})
