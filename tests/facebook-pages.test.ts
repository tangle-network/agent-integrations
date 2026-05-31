import { describe, expect, it } from 'vitest'
import { facebookPagesConnector } from '../src/connectors/adapters/facebook-pages.js'

describe('facebook-pages adapter manifest', () => {
  it('classifies itself as the comms category and exposes the facebook-pages kind', () => {
    expect(facebookPagesConnector.manifest.kind).toBe('facebook-pages')
    expect(facebookPagesConnector.manifest.category).toBe('comms')
    expect(facebookPagesConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares OAuth2 with the documented Meta Graph endpoints and env-var names', () => {
    const auth = facebookPagesConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://www.facebook.com/v19.0/dialog/oauth')
    expect(auth.tokenUrl).toBe('https://graph.facebook.com/v19.0/oauth/access_token')
    expect(auth.clientIdEnv).toBe('FACEBOOK_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('FACEBOOK_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('pages_show_list')
    expect(auth.scopes).toContain('pages_read_engagement')
    expect(auth.scopes).toContain('pages_manage_posts')
    expect(auth.scopes).toContain('pages_manage_engagement')
    expect(auth.scopes).toContain('read_insights')
  })

  it('covers the pages / feed / posts / comments / insights surface', () => {
    const names = facebookPagesConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'users.me',
        'pages.list',
        'pages.get',
        'pages.feed.list',
        'pages.published_posts.list',
        'posts.get',
        'posts.comments.list',
        'pages.insights.read',
        'pages.feed.create',
        'pages.photos.create',
        'posts.update',
        'posts.delete',
        'posts.comments.create',
        'comments.delete',
      ].sort(),
    )
  })

  it('marks feed.create as append-only (cas:none) and edits as optimistic-read-verify', () => {
    const create = facebookPagesConnector.manifest.capabilities.find(
      (c) => c.name === 'pages.feed.create',
    )
    if (create?.class !== 'mutation') throw new Error('unreachable')
    expect(create.cas).toBe('none')
    expect(create.externalEffect).toBe(true)

    const edit = facebookPagesConnector.manifest.capabilities.find(
      (c) => c.name === 'posts.update',
    )
    if (edit?.class !== 'mutation') throw new Error('unreachable')
    expect(edit.cas).toBe('optimistic-read-verify')

    const del = facebookPagesConnector.manifest.capabilities.find((c) => c.name === 'posts.delete')
    if (del?.class !== 'mutation') throw new Error('unreachable')
    expect(del.cas).toBe('native-idempotency')
  })
})
