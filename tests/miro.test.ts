import { describe, expect, it } from 'vitest'
import { miroConnector } from '../src/connectors/adapters/miro'

describe('miro adapter', () => {
  it('uses real Miro OAuth endpoints', () => {
    const auth = miroConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://miro.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.miro.com/v1/oauth/token')
    expect(auth.clientIdEnv).toBe('MIRO_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('MIRO_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(['boards:read', 'boards:write', 'identity:read'])
  })

  it('exposes a non-trivial set of capabilities including reads and at least one mutation', () => {
    const caps = miroConnector.manifest.capabilities
    expect(caps.length).toBeGreaterThanOrEqual(10)
    expect(caps.some((c) => c.class === 'read' && c.name === 'boards.list')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'items.list')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'sticky_notes.create')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'boards.create')).toBe(true)
    expect(caps.some((c) => c.name.startsWith('organizations.'))).toBe(false)
    expect(caps.some((c) => c.name === 'teams.get')).toBe(false)
  })
})
