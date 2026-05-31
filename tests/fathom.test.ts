import { describe, expect, it } from 'vitest'
import { fathomConnector } from '../src/connectors/adapters/fathom.js'

describe('fathom adapter manifest', () => {
  it('exposes the fathom kind under the other category with authoritative consistency', () => {
    expect(fathomConnector.manifest.kind).toBe('fathom')
    expect(fathomConnector.manifest.category).toBe('other')
    expect(fathomConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = fathomConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (summary, transcript, list, team, team-member)', () => {
    const names = fathomConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'recordings.summary.get',
        'recordings.transcript.get',
        'meetings.list',
        'team.find',
        'team.member.find',
      ].sort(),
    )
    const reads = fathomConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'recordings.summary.get',
        'recordings.transcript.get',
        'meetings.list',
        'team.find',
        'team.member.find',
      ].sort(),
    )
    const mutations = fathomConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations).toEqual([])
  })
})
