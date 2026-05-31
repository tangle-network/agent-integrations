import { describe, expect, it } from 'vitest'
import { cannyConnector } from '../src/connectors/adapters/canny.js'

describe('canny adapter manifest', () => {
  it('classifies itself with the canny kind and other category', () => {
    expect(cannyConnector.manifest.kind).toBe('canny')
    expect(cannyConnector.manifest.category).toBe('other')
    expect(cannyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = cannyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (posts + votes)', () => {
    const names = cannyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['posts.create', 'posts.retrieve', 'posts.list', 'votes.create', 'votes.delete'].sort(),
    )
    const reads = cannyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = cannyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['posts.list', 'posts.retrieve'].sort())
    expect(mutations).toEqual(['posts.create', 'votes.create', 'votes.delete'].sort())
  })
})
