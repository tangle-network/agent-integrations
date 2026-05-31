import { describe, expect, it } from 'vitest'
import { mastodonConnector } from '../src/connectors/adapters/mastodon.js'

describe('mastodon adapter manifest', () => {
  it('classifies itself under the comms category and exposes the mastodon kind', () => {
    expect(mastodonConnector.manifest.kind).toBe('mastodon')
    expect(mastodonConnector.manifest.category).toBe('comms')
    expect(mastodonConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (the per-instance access token mirrors the activepieces piece auth shape)', () => {
    const auth = mastodonConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (post.status) plus the read paths the same access token unlocks', () => {
    const names = mastodonConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'post.status',
        'account.verify',
        'status.get',
        'timeline.home',
        'timeline.public',
        'account.statuses',
      ].sort(),
    )
    const reads = mastodonConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = mastodonConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['account.statuses', 'account.verify', 'status.get', 'timeline.home', 'timeline.public'].sort(),
    )
    expect(mutations).toEqual(['post.status'].sort())
  })
})
