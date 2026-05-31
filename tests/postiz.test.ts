import { describe, expect, it } from 'vitest'
import { postizConnector } from '../src/connectors/adapters/postiz.js'

describe('postiz adapter manifest', () => {
  it('classifies itself as the other category and exposes the postiz kind', () => {
    expect(postizConnector.manifest.kind).toBe('postiz')
    expect(postizConnector.manifest.category).toBe('other')
    expect(postizConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = postizConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (posts, integrations, analytics, media)', () => {
    const names = postizConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'posts.create',
        'posts.list',
        'posts.delete',
        'integrations.list',
        'analytics.platform',
        'analytics.post',
        'media.upload',
        'slots.find',
      ].sort(),
    )
    const reads = postizConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = postizConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['posts.list', 'integrations.list', 'analytics.platform', 'analytics.post', 'slots.find'].sort(),
    )
    expect(mutations).toEqual(['posts.create', 'posts.delete', 'media.upload'].sort())
  })
})
