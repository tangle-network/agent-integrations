import { describe, expect, it } from 'vitest'
import { linkedinConnector } from '../src/connectors/adapters/linkedin.js'

describe('linkedin adapter manifest', () => {
  it('classifies itself as the comms category and exposes the linkedin kind', () => {
    expect(linkedinConnector.manifest.kind).toBe('linkedin')
    expect(linkedinConnector.manifest.category).toBe('comms')
    expect(linkedinConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares OAuth2 with the documented LinkedIn endpoints and env-var names', () => {
    const auth = linkedinConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://www.linkedin.com/oauth/v2/authorization')
    expect(auth.tokenUrl).toBe('https://www.linkedin.com/oauth/v2/accessToken')
    expect(auth.clientIdEnv).toBe('LINKEDIN_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('LINKEDIN_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('openid')
    expect(auth.scopes).toContain('profile')
    expect(auth.scopes).toContain('email')
    expect(auth.scopes).toContain('w_member_social')
    expect(auth.scopes).toContain('r_organization_social')
    expect(auth.scopes).toContain('w_organization_social')
    expect(auth.scopes).toContain('rw_organization_admin')
  })

  it('covers profile / organization / posts / comments surfaces', () => {
    const names = linkedinConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'userinfo',
        'organizations.get',
        'organizations.acls.list',
        'posts.create',
        'posts.get',
        'posts.list.byAuthor',
        'posts.delete',
        'comments.list',
        'comments.create',
        'comments.update',
        'comments.delete',
        'socialActions.get',
      ].sort(),
    )
  })

  it('marks posts.create / comments.create as append-only (cas:none) and delete as native-idempotency', () => {
    const create = linkedinConnector.manifest.capabilities.find((c) => c.name === 'posts.create')
    if (create?.class !== 'mutation') throw new Error('unreachable')
    expect(create.cas).toBe('none')
    expect(create.externalEffect).toBe(true)

    const commentCreate = linkedinConnector.manifest.capabilities.find(
      (c) => c.name === 'comments.create',
    )
    if (commentCreate?.class !== 'mutation') throw new Error('unreachable')
    expect(commentCreate.cas).toBe('none')

    const commentUpdate = linkedinConnector.manifest.capabilities.find(
      (c) => c.name === 'comments.update',
    )
    if (commentUpdate?.class !== 'mutation') throw new Error('unreachable')
    expect(commentUpdate.cas).toBe('optimistic-read-verify')

    const del = linkedinConnector.manifest.capabilities.find((c) => c.name === 'posts.delete')
    if (del?.class !== 'mutation') throw new Error('unreachable')
    expect(del.cas).toBe('native-idempotency')
  })
})
