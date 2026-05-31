import { describe, expect, it } from 'vitest'
import { harvestConnector } from '../src/connectors/adapters/harvest.js'

describe('harvest adapter manifest', () => {
  it('exposes the harvest kind under the other category with authoritative consistency', () => {
    expect(harvestConnector.manifest.kind).toBe('harvest')
    expect(harvestConnector.manifest.category).toBe('other')
    expect(harvestConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 against id.getharvest.com with the documented env-var names', () => {
    const auth = harvestConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://id.getharvest.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://id.getharvest.com/api/v2/oauth2/token')
    expect(auth.clientIdEnv).toBe('HARVEST_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('HARVEST_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('harvest:all')
  })

  it('covers the ten Harvest read capabilities from the activepieces catalog', () => {
    const names = harvestConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'invoices.get',
        'projects.get',
        'tasks.get',
        'clients.get',
        'estimates.get',
        'expenses.get',
        'time.entries.get',
        'roles.get',
        'users.get',
        'reports.uninvoiced',
      ].sort(),
    )
    const classes = new Set(harvestConnector.manifest.capabilities.map((c) => c.class))
    expect(classes).toEqual(new Set(['read']))
  })
})
