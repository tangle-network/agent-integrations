import { describe, expect, it } from 'vitest'
import { googleMyBusinessConnector } from '../src/connectors/adapters/google-my-business.js'

describe('google-my-business adapter manifest', () => {
  it('classifies itself as the crm category and exposes the google-my-business kind', () => {
    expect(googleMyBusinessConnector.manifest.kind).toBe('google-my-business')
    expect(googleMyBusinessConnector.manifest.category).toBe('crm')
    expect(googleMyBusinessConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = googleMyBusinessConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the activepieces action surface (reviews.reply.create maps to createReply)', () => {
    const names = googleMyBusinessConnector.manifest.capabilities.map((c) => c.name)
    expect(names).toContain('reviews.reply.create')
    expect(names).toContain('reviews.list')
    expect(names).toContain('accounts.list')
    const reads = googleMyBusinessConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = googleMyBusinessConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['accounts.list', 'locations.list', 'reviews.get', 'reviews.list'].sort(),
    )
    expect(mutations).toEqual(
      ['reviews.reply.create', 'reviews.reply.delete'].sort(),
    )
  })
})
