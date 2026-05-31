import { describe, expect, it } from 'vitest'
import { sentryConnector } from '../src/connectors/adapters/sentry'
import { validateConnectorManifest } from '../src/connectors/types'

describe('sentry adapter', () => {
  it('declares kind, category, consistency model, and OAuth2 auth', () => {
    expect(sentryConnector.manifest.kind).toBe('sentry')
    expect(sentryConnector.manifest.category).toBe('other')
    expect(sentryConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(sentryConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('uses the real Sentry OAuth endpoints documented at docs.sentry.io', () => {
    const auth = sentryConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://sentry.io/oauth/authorize/')
    expect(auth.tokenUrl).toBe('https://sentry.io/oauth/token/')
    expect(auth.clientIdEnv).toBe('SENTRY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('SENTRY_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining([
        'org:read',
        'project:read',
        'project:releases',
        'event:read',
        'event:write',
        'event:admin',
      ]),
    )
  })

  it('exposes the documented issue / event / project / release surface', () => {
    const names = sentryConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'events.get',
        'issues.comments.create',
        'issues.comments.list',
        'issues.delete',
        'issues.events.latest',
        'issues.events.list',
        'issues.get',
        'issues.search',
        'issues.update',
        'organizations.list',
        'projects.get',
        'projects.list',
        'releases.create',
        'releases.delete',
        'releases.deploys.create',
        'releases.get',
        'releases.list',
        'releases.update',
        'teams.list',
      ].sort(),
    )
  })

  it('every mutation declares a CAS strategy and externalEffect, every read names a scope', () => {
    for (const cap of sentryConnector.manifest.capabilities) {
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
    expect(validateConnectorManifest(sentryConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = sentryConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = sentryConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(sentryConnector.executeRead)).toBe(hasReads)
    expect(Boolean(sentryConnector.executeMutation)).toBe(hasMutations)
  })
})
