import { describe, expect, it } from 'vitest'
import { ripplingConnector } from '../src/connectors/adapters/rippling.js'

describe('rippling adapter manifest', () => {
  it('uses oauth2 auth with Rippling app.rippling.com endpoints + workforce scopes', () => {
    const auth = ripplingConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://app.rippling.com/apps/PLATFORM/{appName}/authorize')
    expect(auth.tokenUrl).toBe('https://api.rippling.com/api/o/token/')
    expect(auth.clientIdEnv).toBe('RIPPLING_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('RIPPLING_OAUTH_CLIENT_SECRET')
    expect(auth.tokenClientAuthMethod).toBe('client_secret_basic')
    expect(auth.pkce).toBe('unsupported')
    expect(auth.urlTemplateMetadata).toEqual({
      appName: { kind: 'path-segment' },
    })
    expect(auth.scopes).toContain('company:read')
    expect(auth.scopes).toContain('employees:read')
    expect(auth.scopes).toContain('employees:write')
  })
})
