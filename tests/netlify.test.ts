import { describe, expect, it } from 'vitest'
import { netlifyConnector } from '../src/connectors/adapters/netlify'
import { validateConnectorManifest } from '../src/connectors/types'

describe('netlify adapter', () => {
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

})
