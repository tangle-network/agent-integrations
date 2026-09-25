import { describe, expect, it } from 'vitest'
import { googleAnalyticsConnector } from '../src/connectors/adapters/google-analytics.js'
import { validateConnectorManifest } from '../src/connectors/types.js'

describe('google-analytics adapter manifest', () => {
  it('uses the real Google OAuth2 endpoints + the documented analytics.readonly scope', () => {
    const auth = googleAnalyticsConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(auth.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(auth.scopes).toEqual(['https://www.googleapis.com/auth/analytics.readonly'])
    expect(auth.clientIdEnv).toBe('GOOGLE_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('GOOGLE_OAUTH_CLIENT_SECRET')
    // Google needs access_type=offline + prompt=consent to mint a refresh
    // token reliably; without it a user who's already consented to the
    // OAuth client gets re-bounced with no refresh_token in the response.
    expect(auth.extraAuthParams).toEqual({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    })
  })

  it('runReport requires propertyId, metrics, and dateRanges — the GA4 Data API rejects any of these as missing', () => {
    const runReport = googleAnalyticsConnector.manifest.capabilities.find((c) => c.name === 'properties.runReport')
    if (!runReport) throw new Error('runReport capability missing')
    const params = runReport.parameters as { required?: string[] }
    expect(params.required).toEqual(expect.arrayContaining(['propertyId', 'metrics', 'dateRanges']))
  })

})
