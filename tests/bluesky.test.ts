import { describe, expect, it } from 'vitest'
import { blueskyConnector } from '../src/connectors/adapters/bluesky.js'

describe('bluesky adapter manifest', () => {
  it('classifies itself under the comms category and exposes the bluesky kind', () => {
    expect(blueskyConnector.manifest.kind).toBe('bluesky')
    expect(blueskyConnector.manifest.category).toBe('comms')
    expect(blueskyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (the createSession-derived bearer mirrors the activepieces piece auth shape)', () => {
    const auth = blueskyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (create/like/repost/find post + find thread) plus the read paths the triggers poll', () => {
    const names = blueskyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'create.post',
        'like.post',
        'repost.post',
        'find.post',
        'find.thread',
        'author.feed',
        'timeline.read',
        'followers.list',
      ].sort(),
    )
    const reads = blueskyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = blueskyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['author.feed', 'find.post', 'find.thread', 'followers.list', 'timeline.read'].sort(),
    )
    expect(mutations).toEqual(['create.post', 'like.post', 'repost.post'].sort())
  })
})
