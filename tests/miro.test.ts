import { describe, expect, it } from 'vitest'
import { miroConnector } from '../src/connectors/adapters/miro'
import { validateConnectorManifest } from '../src/connectors/types'

describe('miro adapter', () => {
  it('declares kind, category, and OAuth2 auth', () => {
    expect(miroConnector.manifest.kind).toBe('miro')
    expect(miroConnector.manifest.category).toBe('doc')
    expect(miroConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('uses real Miro OAuth endpoints', () => {
    const auth = miroConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://miro.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.miro.com/v1/oauth/token')
    expect(auth.clientIdEnv).toBe('MIRO_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('MIRO_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining(['boards:read', 'boards:write', 'identity:read']),
    )
  })

  it('exposes a non-trivial set of capabilities including reads and at least one mutation', () => {
    const caps = miroConnector.manifest.capabilities
    expect(caps.length).toBeGreaterThanOrEqual(10)
    expect(caps.some((c) => c.class === 'read' && c.name === 'boards.list')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'items.list')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'sticky_notes.create')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'boards.create')).toBe(true)
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(miroConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = miroConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = miroConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(miroConnector.executeRead)).toBe(hasReads)
    expect(Boolean(miroConnector.executeMutation)).toBe(hasMutations)
  })
})
