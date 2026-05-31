import { describe, expect, it } from 'vitest'
import { leverConnector } from '../src/connectors/adapters/lever.js'

describe('lever adapter manifest', () => {
  it('exposes the lever kind, "other" category, and authoritative consistency', () => {
    expect(leverConnector.manifest.kind).toBe('lever')
    expect(leverConnector.manifest.category).toBe('other')
    expect(leverConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 against auth.lever.co with refresh + admin scopes', () => {
    const auth = leverConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://auth.lever.co/authorize')
    expect(auth.tokenUrl).toBe('https://auth.lever.co/oauth/token')
    expect(auth.clientIdEnv).toBe('LEVER_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('LEVER_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('offline_access')
    expect(auth.scopes).toContain('opportunities:read:admin')
    expect(auth.scopes).toContain('opportunities:write:admin')
    expect(auth.scopes).toContain('postings:write:admin')
  })

  it('covers opportunities, postings, requisitions, users, stages, archive_reasons, sources', () => {
    const names = leverConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'opportunities.search',
        'opportunities.get',
        'opportunities.create',
        'opportunities.addNote',
        'opportunities.advanceStage',
        'opportunities.archive',
        'postings.search',
        'postings.get',
        'postings.create',
        'requisitions.search',
        'requisitions.get',
        'users.search',
        'stages.list',
        'archive_reasons.list',
        'sources.list',
      ].sort(),
    )
  })

  it('splits stage advancement and archive as optimistic-read-verify mutations', () => {
    const byName = new Map(leverConnector.manifest.capabilities.map((c) => [c.name, c]))
    const advance = byName.get('opportunities.advanceStage')
    const archive = byName.get('opportunities.archive')
    const create = byName.get('opportunities.create')
    if (
      !advance || advance.class !== 'mutation' ||
      !archive || archive.class !== 'mutation' ||
      !create || create.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(advance.cas).toBe('optimistic-read-verify')
    expect(archive.cas).toBe('optimistic-read-verify')
    expect(create.cas).toBe('native-idempotency')
  })
})
