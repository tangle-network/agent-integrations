import { describe, expect, it } from 'vitest'
import { clioConnector } from '../src/connectors/adapters/clio.js'

describe('clio adapter manifest', () => {
  it('identifies as clio with an authoritative consistency model', () => {
    expect(clioConnector.manifest.kind).toBe('clio')
    expect(clioConnector.manifest.category).toBe('other')
    expect(clioConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 against Clio documented endpoints and env-var names', () => {
    const auth = clioConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://app.clio.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://app.clio.com/oauth/token')
    expect(auth.clientIdEnv).toBe('CLIO_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('CLIO_OAUTH_CLIENT_SECRET')
    // Clio's public-app OAuth grant is all-or-nothing — the consent screen
    // does not surface named scopes. We honestly model that as an empty list
    // instead of fabricating scope names that Clio would ignore.
    expect(auth.scopes).toEqual([])
  })

  it('covers contacts, matters, tasks, activities, and notes', () => {
    const names = clioConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'users.whoami',
        'contacts.list',
        'contacts.get',
        'contacts.create',
        'contacts.update',
        'matters.list',
        'matters.get',
        'matters.create',
        'matters.update',
        'tasks.list',
        'tasks.get',
        'tasks.create',
        'tasks.update',
        'activities.list',
        'activities.create',
        'notes.list',
        'notes.create',
      ].sort(),
    )

    const reads = clioConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = clioConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(
      [
        'activities.list',
        'contacts.get',
        'contacts.list',
        'matters.get',
        'matters.list',
        'notes.list',
        'tasks.get',
        'tasks.list',
        'users.whoami',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'activities.create',
        'contacts.create',
        'contacts.update',
        'matters.create',
        'matters.update',
        'notes.create',
        'tasks.create',
        'tasks.update',
      ].sort(),
    )
  })

  it('routes etag-if-match on updates and native-idempotency on creates', () => {
    const byName = new Map(clioConnector.manifest.capabilities.map((c) => [c.name, c]))
    for (const updateName of ['contacts.update', 'matters.update', 'tasks.update']) {
      const cap = byName.get(updateName)
      expect(cap?.class).toBe('mutation')
      if (cap?.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('etag-if-match')
    }
    for (const createName of [
      'contacts.create',
      'matters.create',
      'tasks.create',
      'activities.create',
      'notes.create',
    ]) {
      const cap = byName.get(createName)
      expect(cap?.class).toBe('mutation')
      if (cap?.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
    }
  })
})
