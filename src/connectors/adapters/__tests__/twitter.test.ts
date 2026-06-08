import { describe, expect, it } from 'vitest'
import { twitterConnector } from '../twitter.js'
import { manifestToConnector } from '../../../adapter-provider.js'
import { validateConnectorManifest } from '../../types.js'

describe('twitter adapter', () => {
  it('declares OAuth as preferred auth while still supporting API-key tokens', () => {
    expect(validateConnectorManifest(twitterConnector.manifest)).toEqual({ ok: true, issues: [] })
    expect(twitterConnector.manifest.auth).toMatchObject({
      kind: 'one_of',
      preferred: 'oauth2',
    })
    if (twitterConnector.manifest.auth.kind !== 'one_of') throw new Error('expected dual auth')
    expect(twitterConnector.manifest.auth.options.map((auth) => auth.kind)).toEqual(['oauth2', 'api-key'])
    expect(twitterConnector.manifest.auth.options[0]).toMatchObject({
      authorizationUrl: 'https://twitter.com/i/oauth2/authorize',
      tokenUrl: 'https://api.twitter.com/2/oauth2/token',
      clientIdEnv: 'TWITTER_OAUTH_CLIENT_ID',
      clientSecretEnv: 'TWITTER_OAUTH_CLIENT_SECRET',
    })

    const connector = manifestToConnector('twitter', twitterConnector)
    expect(connector.auth).toBe('oauth2')
    expect(connector.metadata).toMatchObject({
      authOptions: ['oauth2', 'api-key'],
      preferredAuth: 'oauth2',
    })
  })
})
