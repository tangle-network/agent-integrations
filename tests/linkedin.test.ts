import { describe, expect, it } from 'vitest'
import {
  createLinkedinConnector,
  linkedinConnector,
} from '../src/connectors/adapters/linkedin.js'

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
    expect(auth.scopes).toEqual(['openid', 'profile', 'email', 'w_member_social'])
  })

  it('exposes only self-serve member capabilities by default', () => {
    const names = linkedinConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'userinfo',
        'posts.create',
        'posts.delete',
        'comments.create',
        'comments.update',
        'comments.delete',
      ].sort(),
    )

    const declaredScopes = new Set(
      (linkedinConnector.manifest.auth.kind === 'oauth2'
        ? linkedinConnector.manifest.auth.scopes
        : []),
    )
    for (const capability of linkedinConnector.manifest.capabilities) {
      for (const scope of capability.requiredScopes ?? []) {
        expect(declaredScopes.has(scope), `${capability.name}: ${scope}`).toBe(true)
      }
    }
  })

  it('adds organization scopes and capabilities only when explicitly configured', () => {
    const organizationConnector = createLinkedinConnector({ organizationAccess: true })
    const auth = organizationConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.scopes).toEqual([
      'openid',
      'profile',
      'email',
      'w_member_social',
      'r_organization_social',
      'w_organization_social',
      'rw_organization_admin',
    ])

    const names = organizationConnector.manifest.capabilities.map((c) => c.name).sort()
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

    const postsCreate = organizationConnector.manifest.capabilities.find(
      (capability) => capability.name === 'posts.create',
    )
    expect(postsCreate?.requiredScopes).toEqual(['w_organization_social'])
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
