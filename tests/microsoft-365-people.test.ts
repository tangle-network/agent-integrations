import { describe, expect, it } from 'vitest'
import { microsoft365PeopleConnector } from '../src/connectors/adapters/microsoft-365-people.js'

describe('microsoft-365-people adapter manifest', () => {
  it('classifies itself as the crm category and exposes the microsoft-365-people kind', () => {
    expect(microsoft365PeopleConnector.manifest.kind).toBe('microsoft-365-people')
    expect(microsoft365PeopleConnector.manifest.category).toBe('crm')
    expect(microsoft365PeopleConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth against the Microsoft identity platform v2.0 endpoints', () => {
    const auth = microsoft365PeopleConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind === 'oauth2') {
      expect(auth.authorizationUrl).toBe(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      )
      expect(auth.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
      expect(auth.scopes).toContain('offline_access')
      expect(auth.scopes).toContain('Contacts.ReadWrite')
    }
  })

  it('covers the full activepieces action set (contacts + contact folders)', () => {
    const names = microsoft365PeopleConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'create.contact',
        'create.contact.folder',
        'delete.contact',
        'get.contact.folder',
        'search.contacts',
        'update.contact',
      ].sort(),
    )
    const reads = microsoft365PeopleConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = microsoft365PeopleConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.contact.folder', 'search.contacts'].sort())
    expect(mutations).toEqual(
      ['create.contact', 'create.contact.folder', 'delete.contact', 'update.contact'].sort(),
    )
  })
})
