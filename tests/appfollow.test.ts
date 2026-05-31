import { describe, expect, it } from 'vitest'
import { appfollowConnector } from '../src/connectors/adapters/appfollow.js'

describe('appfollow adapter manifest', () => {
  it('classifies itself as the database category and exposes the appfollow kind', () => {
    expect(appfollowConnector.manifest.kind).toBe('appfollow')
    expect(appfollowConnector.manifest.category).toBe('database')
    expect(appfollowConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = appfollowConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces actions (reply.to.review, add.user) plus read counterparts for the triggers', () => {
    const names = appfollowConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['add.user', 'reply.to.review', 'reviews.list', 'tags.list'].sort())

    const mutations = appfollowConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['add.user', 'reply.to.review'].sort())

    const reads = appfollowConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['reviews.list', 'tags.list'].sort())
  })
})
