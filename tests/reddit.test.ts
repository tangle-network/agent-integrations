import { describe, expect, it } from 'vitest'
import { redditConnector } from '../src/connectors/adapters/reddit.js'

describe('reddit adapter manifest', () => {
  it('classifies itself as the comms category and exposes the reddit kind', () => {
    expect(redditConnector.manifest.kind).toBe('reddit')
    expect(redditConnector.manifest.category).toBe('comms')
    expect(redditConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with Reddit OAuth endpoints and scopes', () => {
    const auth = redditConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/reddit.com/)
    expect(auth.tokenUrl).toMatch(/reddit.com/)
    expect(auth.scopes).toContain('read')
    expect(auth.scopes).toContain('submit')
    expect(auth.scopes).toContain('edit')
  })

  it('covers post, comment, and retrieval capability surface', () => {
    const names = redditConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'post.retrieve',
        'post.details',
        'post.create',
        'comment.create',
        'comments.fetch',
        'post.edit',
        'comment.edit',
        'post.delete',
        'comment.delete',
      ].sort(),
    )
    const mutations = redditConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['post.create', 'comment.create', 'post.edit', 'comment.edit', 'post.delete', 'comment.delete'].sort(),
    )
  })
})
