import { describe, expect, it } from 'vitest'
import { capsuleCrmConnector } from '../src/index'

describe('capsule-crm declarative adapter', () => {
  it('exposes the documented OAuth2 manifest shape from the catalog', () => {
    expect(capsuleCrmConnector.manifest.kind).toBe('capsule-crm')
    expect(capsuleCrmConnector.manifest.category).toBe('crm')
    expect(capsuleCrmConnector.manifest.auth.kind).toBe('oauth2')

    if (capsuleCrmConnector.manifest.auth.kind !== 'oauth2') {
      throw new Error('expected oauth2 auth')
    }
    const auth = capsuleCrmConnector.manifest.auth
    expect(auth.authorizationUrl).toBe('https://api.capsulecrm.com/oauth/authorise')
    expect(auth.tokenUrl).toBe('https://api.capsulecrm.com/oauth/token')
    expect(auth.scopes).toEqual(expect.arrayContaining(['read', 'write']))
    expect(auth.clientIdEnv).toBe('CAPSULE_CRM_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('CAPSULE_CRM_OAUTH_CLIENT_SECRET')
  })

  it('covers the Capsule v2 surface for parties, opportunities, kases, tasks, entries, and users', () => {
    const names = capsuleCrmConnector.manifest.capabilities.map((cap) => cap.name).sort()
    expect(names).toEqual(
      [
        'entries.create',
        'kases.create',
        'kases.search',
        'kases.update',
        'opportunities.create',
        'opportunities.search',
        'opportunities.update',
        'parties.create',
        'parties.get',
        'parties.search',
        'parties.update',
        'tasks.create',
        'tasks.list',
        'tasks.update',
        'users.list',
      ].sort(),
    )

    const writes = capsuleCrmConnector.manifest.capabilities.filter(
      (cap) => cap.class === 'mutation',
    )
    expect(writes.length).toBeGreaterThanOrEqual(9)
    for (const cap of writes) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.externalEffect).toBe(true)
      expect(['native-idempotency', 'optimistic-read-verify', 'none']).toContain(cap.cas)
    }
  })
})
