import { describe, expect, it } from 'vitest'
import { twitter, twitterConnector } from '../twitter.js'
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

  it('twitter(opts) factory carries the same manifest and adds the OAuth client surface', () => {
    const adapter = twitter({ clientId: 'cid', clientSecret: 'sec' })
    expect(validateConnectorManifest(adapter.manifest)).toEqual({ ok: true, issues: [] })
    expect(adapter.manifest).toEqual(twitterConnector.manifest)
    expect(typeof adapter.exchangeOAuth).toBe('function')
    expect(typeof adapter.refreshToken).toBe('function')

    const connector = manifestToConnector('twitter', adapter)
    expect(connector.auth).toBe('oauth2')
    expect(connector.metadata).toMatchObject({
      authOptions: ['oauth2', 'api-key'],
      preferredAuth: 'oauth2',
    })
  })
})
