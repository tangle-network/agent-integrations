import { describe, expect, it } from 'vitest'
import { talkableConnector } from '../src/connectors/adapters/talkable.js'

describe('talkable adapter manifest', () => {
  it('classifies itself as the crm category and exposes the talkable kind', () => {
    expect(talkableConnector.manifest.kind).toBe('talkable')
    expect(talkableConnector.manifest.category).toBe('crm')
    expect(talkableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = talkableConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (advocates, referrals, rewards, campaigns, events, offers)', () => {
    const names = talkableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'advocates.list',
        'advocates.get',
        'referrals.list',
        'referrals.create',
        'rewards.list',
        'campaigns.list',
        'events.track',
        'offers.list',
      ].sort(),
    )
    const reads = talkableConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = talkableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['advocates.list', 'advocates.get', 'referrals.list', 'rewards.list', 'campaigns.list', 'offers.list'].sort(),
    )
    expect(mutations).toEqual(['referrals.create', 'events.track'].sort())
  })
})
