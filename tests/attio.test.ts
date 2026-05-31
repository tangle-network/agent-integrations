import { describe, expect, it } from 'vitest'
import { attioConnector } from '../src/connectors/adapters/attio.js'

describe('attio adapter manifest', () => {
  it('classifies itself as the crm category and exposes the attio kind', () => {
    expect(attioConnector.manifest.kind).toBe('attio')
    expect(attioConnector.manifest.category).toBe('crm')
    expect(attioConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the documented Attio endpoints and env-var names', () => {
    const auth = attioConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://app.attio.com/authorize')
    expect(auth.tokenUrl).toBe('https://app.attio.com/oauth/token')
    expect(auth.clientIdEnv).toBe('ATTIO_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('ATTIO_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('record_permission:read-write')
    expect(auth.scopes).toContain('list_entry:read-write')
  })

  it('covers the record CRUD pack plus list entries, notes, and tasks', () => {
    const names = attioConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.query',
        'records.get',
        'records.create',
        'records.assert',
        'records.update',
        'records.delete',
        'lists.entries.query',
        'lists.entries.create',
        'notes.create',
        'tasks.create',
      ].sort(),
    )
    const reads = attioConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = attioConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['lists.entries.query', 'records.get', 'records.query'])
    expect(mutations).toEqual(
      [
        'lists.entries.create',
        'notes.create',
        'records.assert',
        'records.create',
        'records.delete',
        'records.update',
        'tasks.create',
      ].sort(),
    )
  })
})
