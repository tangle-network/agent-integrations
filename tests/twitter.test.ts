import { describe, expect, it } from 'vitest'
import { twitterConnector } from '../src/connectors/adapters/twitter.js'

describe('twitter adapter manifest', () => {
  it('classifies itself as the comms category and exposes the twitter kind', () => {
    expect(twitterConnector.manifest.kind).toBe('twitter')
    expect(twitterConnector.manifest.category).toBe('comms')
    expect(twitterConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Twitter-specific hint', () => {
    const auth = twitterConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Twitter/i)
  })

  it('covers tweets create and reply capability surface', () => {
    const names = twitterConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('tweets.create')
    expect(names).toContain('tweets.reply')
  })

  it('marks tweet operations as mutations', () => {
    const mutations = twitterConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('tweets.create')
    expect(mutations).toContain('tweets.reply')
  })
})
