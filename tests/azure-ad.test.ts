import { describe, expect, it } from 'vitest'
import { azureAdConnector } from '../src/connectors/adapters/azure-ad.js'

describe('azure-ad adapter manifest', () => {
  it('classifies itself as the crm category and exposes the azure-ad kind', () => {
    expect(azureAdConnector.manifest.kind).toBe('azure-ad')
    expect(azureAdConnector.manifest.category).toBe('crm')
    expect(azureAdConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = azureAdConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers user, group, member, license, and revoke-session paths from the activepieces actions', () => {
    const names = azureAdConnector.manifest.capabilities.map((c) => c.name)
    expect(names).toContain('users.list')
    expect(names).toContain('users.list.enabled')
    expect(names).toContain('users.get')
    expect(names).toContain('users.create')
    expect(names).toContain('users.update')
    expect(names).toContain('users.delete')
    expect(names).toContain('users.revoke.sessions')
    expect(names).toContain('users.license.assign')
    expect(names).toContain('groups.get')
    expect(names).toContain('groups.attributes.get')
    expect(names).toContain('groups.attributes.reset')
    expect(names).toContain('groups.create')
    expect(names).toContain('groups.delete')
    expect(names).toContain('groups.members.list')
    expect(names).toContain('groups.members.add')

    const reads = azureAdConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('users.list')
    expect(reads).toContain('groups.members.list')

    const mutations = azureAdConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toContain('users.create')
    expect(mutations).toContain('users.delete')
    expect(mutations).toContain('groups.create')
    expect(mutations).toContain('groups.members.add')
  })
})
