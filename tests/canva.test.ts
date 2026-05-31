import { describe, expect, it } from 'vitest'
import { canvaConnector } from '../src/connectors/adapters/canva'
import { validateConnectorManifest } from '../src/connectors/types'

describe('canva adapter', () => {
  it('declares kind, category, and OAuth2 auth', () => {
    expect(canvaConnector.manifest.kind).toBe('canva')
    expect(canvaConnector.manifest.category).toBe('doc')
    expect(canvaConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('uses real Canva Connect OAuth endpoints and client env vars', () => {
    const auth = canvaConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://www.canva.com/api/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.canva.com/rest/oauth/token')
    expect(auth.clientIdEnv).toBe('CANVA_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('CANVA_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining([
        'design:content:read',
        'design:content:write',
        'asset:write',
        'comment:write',
        'folder:write',
        'brandtemplate:content:read',
        'profile:read',
      ]),
    )
  })

  it('exposes a non-trivial capability surface including async-job pollers', () => {
    const caps = canvaConnector.manifest.capabilities
    expect(caps.length).toBeGreaterThanOrEqual(15)
    expect(caps.some((c) => c.class === 'read' && c.name === 'designs.get')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'comments.list')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'exports.get')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'autofills.get')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'designs.create')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'comments.create')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'exports.create')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'autofills.create')).toBe(true)
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(canvaConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('wires read + mutation handlers because both classes are declared', () => {
    const hasReads = canvaConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = canvaConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(hasReads).toBe(true)
    expect(hasMutations).toBe(true)
    expect(Boolean(canvaConnector.executeRead)).toBe(true)
    expect(Boolean(canvaConnector.executeMutation)).toBe(true)
  })

  it('binds every capability to at least one Canva Connect scope', () => {
    const caps = canvaConnector.manifest.capabilities
    for (const cap of caps) {
      expect(cap.requiredScopes, `${cap.name} must declare scopes`).toBeDefined()
      expect((cap.requiredScopes ?? []).length).toBeGreaterThan(0)
    }
  })
})
