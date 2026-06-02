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
      [
        'reviews.reply.create',
        'reviews.reply.delete',
        'localPosts.create',
        'localPosts.delete',
        'media.create',
      ].sort(),
    )
  })

  it('declares write-side mutations with the correct CAS + externalEffect', () => {
    const byName = new Map(googleMyBusinessConnector.manifest.capabilities.map((c) => [c.name, c]))
    const postCreate = byName.get('localPosts.create')
    const postDelete = byName.get('localPosts.delete')
    const mediaCreate = byName.get('media.create')
    if (
      !postCreate || postCreate.class !== 'mutation' ||
      !postDelete || postDelete.class !== 'mutation' ||
      !mediaCreate || mediaCreate.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    // POST endpoints have no upstream idempotency token, so cas='none' +
    // MutationGuard's idempotency-key layer dedupes above the connector.
    expect(postCreate.cas).toBe('none')
    expect(postCreate.externalEffect).toBe(true)
    expect(mediaCreate.cas).toBe('none')
    expect(mediaCreate.externalEffect).toBe(true)
    // DELETE on an already-deleted resource is naturally idempotent.
    expect(postDelete.cas).toBe('native-idempotency')
    expect(postDelete.externalEffect).toBe(true)
  })

  it('every capability requires the business.manage scope', () => {
    for (const cap of googleMyBusinessConnector.manifest.capabilities) {
      expect(cap.requiredScopes).toContain('https://www.googleapis.com/auth/business.manage')
    }
  })
})
