import { describe, expect, it } from 'vitest'
import { ripplingConnector } from '../src/connectors/adapters/rippling.js'

describe('rippling adapter manifest', () => {
  it('exposes the rippling kind, "other" category, and authoritative consistency', () => {
    expect(ripplingConnector.manifest.kind).toBe('rippling')
    expect(ripplingConnector.manifest.category).toBe('other')
    expect(ripplingConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth with Rippling app.rippling.com endpoints + workforce scopes', () => {
    const auth = ripplingConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://app.rippling.com/apps/{client_id}/install')
    expect(auth.tokenUrl).toBe('https://app.rippling.com/api/o/token/')
    expect(auth.clientIdEnv).toBe('RIPPLING_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('RIPPLING_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('company:read')
    expect(auth.scopes).toContain('employees:read')
    expect(auth.scopes).toContain('employees:write')
  })

  it('covers company, employees, groups, departments, work locations, teams, and activity', () => {
    const names = ripplingConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'company.get',
        'me.get',
        'employees.list',
        'employees.get',
        'employees.update',
        'groups.list',
        'groups.get',
        'departments.list',
        'departments.get',
        'work_locations.list',
        'work_locations.get',
        'teams.list',
        'company_activity.list',
      ].sort(),
    )
  })

  it('classifies reads vs the single employees.update mutation correctly', () => {
    const reads = ripplingConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    const mutations = ripplingConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toEqual(['employees.update'])
    expect(reads).toHaveLength(12)
  })

  it('uses optimistic-read-verify CAS for employees.update (PATCH against authoritative HRIS data)', () => {
    const update = ripplingConnector.manifest.capabilities.find((c) => c.name === 'employees.update')
    if (!update || update.class !== 'mutation') throw new Error('expected mutation employees.update')
    expect(update.cas).toBe('optimistic-read-verify')
  })
})
