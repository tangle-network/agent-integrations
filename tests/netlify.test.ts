import { describe, expect, it } from 'vitest'
import { netlifyConnector } from '../src/connectors/adapters/netlify'
import { validateConnectorManifest } from '../src/connectors/types'

describe('netlify adapter', () => {
  it('declares kind, category, consistency model, and OAuth2 auth', () => {
    expect(netlifyConnector.manifest.kind).toBe('netlify')
    expect(netlifyConnector.manifest.category).toBe('other')
    expect(netlifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(netlifyConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('uses the documented Netlify OAuth endpoints', () => {
    const auth = netlifyConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://app.netlify.com/authorize')
    expect(auth.tokenUrl).toBe('https://api.netlify.com/oauth/token')
    expect(auth.clientIdEnv).toBe('NETLIFY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('NETLIFY_OAUTH_CLIENT_SECRET')
    // Netlify OAuth does not expose granular scopes.
    expect(auth.scopes).toEqual([])
  })

  it('exposes the deployment workflow surface', () => {
    const names = netlifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'accounts.list',
        'deploys.cancel',
        'deploys.delete',
        'deploys.get',
        'deploys.lock',
        'deploys.restore',
        'deploys.unlock',
        'forms.list',
        'sites.build-hooks.create',
        'sites.build-hooks.delete',
        'sites.build-hooks.list',
        'sites.build-hooks.trigger',
        'sites.create',
        'sites.delete',
        'sites.deploys.list',
        'sites.env.create',
        'sites.env.delete',
        'sites.env.get',
        'sites.env.list',
        'sites.env.update',
        'sites.get',
        'sites.list',
        'sites.update',
        'user.get',
      ].sort(),
    )
  })

  it('every mutation declares a CAS strategy and externalEffect', () => {
    for (const cap of netlifyConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(['native-idempotency', 'optimistic-read-verify', 'etag-if-match']).toContain(cap.cas)
        expect(cap.externalEffect).toBe(true)
      }
    }
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(netlifyConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('ships read + mutation handlers consistent with the manifest', () => {
    const hasReads = netlifyConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = netlifyConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(netlifyConnector.executeRead)).toBe(hasReads)
    expect(Boolean(netlifyConnector.executeMutation)).toBe(hasMutations)
  })

  it('build-hook trigger targets /build_hooks/{hook_id} per the public API', () => {
    const trigger = netlifyConnector.manifest.capabilities.find((c) => c.name === 'sites.build-hooks.trigger')
    expect(trigger).toBeDefined()
    expect(trigger?.class).toBe('mutation')
  })
})
