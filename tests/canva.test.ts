import { describe, expect, it } from 'vitest'
import { canvaConnector } from '../src/connectors/adapters/canva'
import { validateConnectorManifest } from '../src/connectors/types'

describe('canva adapter', () => {
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

})
