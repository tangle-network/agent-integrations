import { describe, expect, it } from 'vitest'
import { webflowConnector } from '../src/connectors/adapters/webflow'
import { validateConnectorManifest } from '../src/connectors/types'

describe('webflow adapter', () => {
  it('declares kind, category, and OAuth2 auth', () => {
    expect(webflowConnector.manifest.kind).toBe('webflow')
    expect(webflowConnector.manifest.displayName).toBe('Webflow')
    expect(webflowConnector.manifest.category).toBe('doc')
    expect(webflowConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(webflowConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('uses real Webflow OAuth endpoints with the four standard fields', () => {
    const auth = webflowConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://webflow.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.webflow.com/oauth/access_token')
    expect(auth.clientIdEnv).toBe('WEBFLOW_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('WEBFLOW_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining(['sites:read', 'cms:read', 'cms:write', 'pages:read', 'forms:read']),
    )
  })

  it('covers sites, collections, items, pages, and forms', () => {
    const names = webflowConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'sites.list',
        'sites.get',
        'collections.list',
        'collections.get',
        'items.list',
        'items.get',
        'items.create',
        'items.update',
        'items.delete',
        'items.publish',
        'pages.list',
        'forms.list',
        'forms.submissions',
      ].sort(),
    )
  })

  it('classifies CRUD correctly: reads vs mutations', () => {
    const reads = webflowConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = webflowConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(
      [
        'collections.get',
        'collections.list',
        'forms.list',
        'forms.submissions',
        'items.get',
        'items.list',
        'pages.list',
        'sites.get',
        'sites.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      ['items.create', 'items.delete', 'items.publish', 'items.update'].sort(),
    )
  })

  it('uses native-idempotency CAS for every mutation (Webflow Data API has no ETag/If-Match)', () => {
    const mutations = webflowConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('expected mutation')
      expect(m.cas).toBe('native-idempotency')
      expect(m.externalEffect).toBe(true)
    }
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(webflowConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = webflowConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = webflowConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(webflowConnector.executeRead)).toBe(hasReads)
    expect(Boolean(webflowConnector.executeMutation)).toBe(hasMutations)
  })

  it('scopes write capabilities to cms:write only', () => {
    const writes = webflowConnector.manifest.capabilities.filter((c) =>
      c.name.startsWith('items.') && c.class === 'mutation',
    )
    for (const w of writes) {
      expect(w.requiredScopes).toEqual(['cms:write'])
    }
  })
})
