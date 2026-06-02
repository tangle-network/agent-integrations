import { describe, expect, it } from 'vitest'
import { googleContactsConnector } from '../src/connectors/adapters/google-contacts.js'

describe('google-contacts adapter manifest', () => {
  it('classifies itself as crm and exposes the google-contacts kind', () => {
    expect(googleContactsConnector.manifest.kind).toBe('google-contacts')
    expect(googleContactsConnector.manifest.displayName).toBe('Google Contacts')
    expect(googleContactsConnector.manifest.category).toBe('crm')
    expect(googleContactsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares Google OAuth2 with the documented endpoints and env-var names', () => {
    const auth = googleContactsConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(auth.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(auth.clientIdEnv).toBe('GOOGLE_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('GOOGLE_OAUTH_CLIENT_SECRET')
    expect(auth.extraAuthParams?.access_type).toBe('offline')
    expect(auth.extraAuthParams?.prompt).toBe('consent')
  })

  it('requests the People API scope ladder (contacts, other-contacts, directory)', () => {
    const auth = googleContactsConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/contacts')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/contacts.readonly')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/contacts.other.readonly')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/directory.readonly')
    for (const scope of auth.scopes) {
      expect(scope.startsWith('https://www.googleapis.com/auth/')).toBe(true)
    }
  })

  it('covers people, otherContacts, and directory with a read/mutation split', () => {
    const names = googleContactsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'people.get',
        'people.list',
        'people.search',
        'people.batchGet',
        'people.create',
        'people.update',
        'people.delete',
        'otherContacts.list',
        'otherContacts.search',
        'directory.list',
        'directory.search',
        'groups.create',
      ].sort(),
    )
    const mutations = googleContactsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['people.create', 'people.update', 'people.delete', 'groups.create'].sort())
  })

  it('encodes People API concurrency semantics: create=none, update=etag-if-match, delete=native-idempotency', () => {
    const byName = new Map(googleContactsConnector.manifest.capabilities.map((c) => [c.name, c]))
    const create = byName.get('people.create')
    const update = byName.get('people.update')
    const del = byName.get('people.delete')
    if (
      !create || create.class !== 'mutation' ||
      !update || update.class !== 'mutation' ||
      !del || del.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(create.cas).toBe('none')
    expect(create.externalEffect).toBe(true)
    expect(update.cas).toBe('etag-if-match')
    expect(update.externalEffect).toBe(true)
    expect(del.cas).toBe('native-idempotency')
    expect(del.externalEffect).toBe(true)
  })

  it('every capability declares at least one requiredScopes entry from the OAuth grant list', () => {
    const auth = googleContactsConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    const declared = new Set(auth.scopes)
    for (const cap of googleContactsConnector.manifest.capabilities) {
      expect(cap.requiredScopes && cap.requiredScopes.length).toBeGreaterThan(0)
      for (const scope of cap.requiredScopes ?? []) {
        expect(declared.has(scope)).toBe(true)
      }
    }
  })

  it('declares groups.create as native-idempotency external effect against contactGroups', () => {
    const byName = new Map(googleContactsConnector.manifest.capabilities.map((c) => [c.name, c]))
    const create = byName.get('groups.create')
    if (!create || create.class !== 'mutation') throw new Error('expected mutation')
    expect(create.cas).toBe('native-idempotency')
    expect(create.externalEffect).toBe(true)
    expect(create.requiredScopes).toContain('https://www.googleapis.com/auth/contacts')
  })

  it('contains no TODO/FIXME/placeholder text', () => {
    const json = JSON.stringify(googleContactsConnector.manifest)
    expect(json).not.toMatch(/TODO|FIXME|placeholder|xxx/i)
  })
})
