import { describe, expect, it } from 'vitest'
import { auth0Connector } from '../src/connectors/adapters/auth0.js'

describe('auth0 adapter manifest', () => {
  it('exposes the auth0 kind under the other category with authoritative consistency', () => {
    expect(auth0Connector.manifest.kind).toBe('auth0')
    expect(auth0Connector.manifest.category).toBe('other')
    expect(auth0Connector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with documented Auth0 Management API endpoints and env-var names', () => {
    const auth = auth0Connector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/^https:\/\/.+\.auth0\.com\/authorize$/)
    expect(auth.tokenUrl).toMatch(/^https:\/\/.+\.auth0\.com\/oauth\/token$/)
    expect(auth.clientIdEnv).toBe('AUTH0_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('AUTH0_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('read:users')
    expect(auth.scopes).toContain('create:users')
    expect(auth.scopes).toContain('read:roles')
    expect(auth.scopes).toContain('read:organizations')
    expect(auth.scopes).toContain('read:logs')
  })

  it('covers the Management API CRUD surface for users, roles, organizations, connections, clients, grants, logs', () => {
    const names = auth0Connector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('users.list')
    expect(names).toContain('users.get')
    expect(names).toContain('users.create')
    expect(names).toContain('users.update')
    expect(names).toContain('users.delete')
    expect(names).toContain('users.roles.assign')
    expect(names).toContain('users.roles.remove')
    expect(names).toContain('roles.create')
    expect(names).toContain('roles.delete')
    expect(names).toContain('organizations.list')
    expect(names).toContain('organizations.create')
    expect(names).toContain('organizations.members.add')
    expect(names).toContain('organizations.members.remove')
    expect(names).toContain('connections.list')
    expect(names).toContain('clients.list')
    expect(names).toContain('grants.revoke')
    expect(names).toContain('logs.search')

    const reads = auth0Connector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    const mutations = auth0Connector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name)
    expect(reads).toContain('logs.search')
    expect(reads).toContain('users.list')
    expect(mutations).toContain('users.create')
    expect(mutations).toContain('grants.revoke')
  })
})
