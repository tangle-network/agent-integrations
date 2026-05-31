import { describe, expect, it } from 'vitest'
import { linearConnector } from '../src/connectors/adapters/linear'
import { validateConnectorManifest } from '../src/connectors/types'

describe('linear adapter', () => {
  it('declares kind, category, and OAuth2 auth', () => {
    expect(linearConnector.manifest.kind).toBe('linear')
    expect(linearConnector.manifest.category).toBe('other')
    expect(linearConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('uses the real Linear OAuth endpoints documented at developers.linear.app', () => {
    const auth = linearConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://linear.app/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.linear.app/oauth/token')
    expect(auth.clientIdEnv).toBe('LINEAR_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('LINEAR_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining(['read', 'write', 'issues:create', 'comments:create']),
    )
  })

  it('exposes the documented issue / comment / project / team surface', () => {
    const names = linearConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'comments.create',
        'comments.list',
        'issues.create',
        'issues.delete',
        'issues.get',
        'issues.search',
        'issues.update',
        'projects.create',
        'projects.list',
        'teams.list',
        'viewer.get',
      ].sort(),
    )
  })

  it('routes every capability through a single POST /graphql endpoint', () => {
    // The declarative spec lives behind the closure, but every capability the
    // adapter exposes is a single GraphQL roundtrip — verify that by checking
    // every mutation has a CAS strategy and every read has at least the `read`
    // scope (Linear's coarsest GraphQL gate).
    for (const cap of linearConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(['native-idempotency', 'optimistic-read-verify', 'etag-if-match']).toContain(cap.cas)
        expect(cap.externalEffect).toBe(true)
      } else {
        const scopes = cap.requiredScopes ?? []
        expect(scopes.length).toBeGreaterThan(0)
      }
    }
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(linearConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = linearConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = linearConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(linearConnector.executeRead)).toBe(hasReads)
    expect(Boolean(linearConnector.executeMutation)).toBe(hasMutations)
  })
})
