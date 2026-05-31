import { describe, expect, it } from 'vitest'
import { figmaConnector } from '../src/connectors/adapters/figma'
import { validateConnectorManifest } from '../src/connectors/types'

describe('figma adapter', () => {
  it('declares kind, category, and OAuth2 auth', () => {
    expect(figmaConnector.manifest.kind).toBe('figma')
    expect(figmaConnector.manifest.category).toBe('doc')
    expect(figmaConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('uses real Figma OAuth endpoints', () => {
    const auth = figmaConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://www.figma.com/oauth')
    expect(auth.tokenUrl).toBe('https://api.figma.com/v1/oauth/token')
    expect(auth.clientIdEnv).toBe('FIGMA_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('FIGMA_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining(['files:read', 'file_comments:write']),
    )
  })

  it('exposes a non-trivial set of capabilities including reads and at least one mutation', () => {
    const caps = figmaConnector.manifest.capabilities
    expect(caps.length).toBeGreaterThanOrEqual(10)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.get')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.comments.list')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'files.comments.create')).toBe(true)
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(figmaConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = figmaConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = figmaConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(figmaConnector.executeRead)).toBe(hasReads)
    expect(Boolean(figmaConnector.executeMutation)).toBe(hasMutations)
  })
})
