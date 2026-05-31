import { describe, expect, it } from 'vitest'
import { biginByZohoConnector } from '../src/index'

describe('bigin-by-zoho declarative adapter', () => {
  it('exposes the documented OAuth2 manifest shape from the catalog', () => {
    expect(biginByZohoConnector.manifest.kind).toBe('bigin-by-zoho')
    expect(biginByZohoConnector.manifest.category).toBe('crm')
    expect(biginByZohoConnector.manifest.auth.kind).toBe('oauth2')

    if (biginByZohoConnector.manifest.auth.kind !== 'oauth2') {
      throw new Error('expected oauth2 auth')
    }
    const auth = biginByZohoConnector.manifest.auth
    expect(auth.authorizationUrl).toBe('https://accounts.zoho.com/oauth/v2/auth')
    expect(auth.tokenUrl).toBe('https://accounts.zoho.com/oauth/v2/token')
    expect(auth.scopes).toEqual(
      expect.arrayContaining([
        'ZohoBigin.modules.ALL',
        'ZohoBigin.users.READ',
        'offline_access',
      ]),
    )
    expect(auth.clientIdEnv).toBe('BIGIN_BY_ZOHO_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('BIGIN_BY_ZOHO_OAUTH_CLIENT_SECRET')
  })

  it('covers the catalog action surface for companies, contacts, tasks, calls, events, and pipelines', () => {
    const names = biginByZohoConnector.manifest.capabilities.map((cap) => cap.name).sort()
    expect(names).toEqual(
      [
        'call.create',
        'company.create',
        'company.update',
        'contact.create',
        'contact.update',
        'event.create',
        'event.update',
        'pipeline.record.create',
        'pipeline.record.update',
        'records.search',
        'task.create',
        'task.update',
        'users.search',
      ].sort(),
    )

    const writes = biginByZohoConnector.manifest.capabilities.filter(
      (cap) => cap.class === 'mutation',
    )
    expect(writes.length).toBeGreaterThanOrEqual(11)
    for (const cap of writes) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.externalEffect).toBe(true)
      expect(['native-idempotency', 'optimistic-read-verify', 'none']).toContain(cap.cas)
    }
  })
})
