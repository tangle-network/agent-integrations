import { describe, expect, it } from 'vitest'
import { googleAnalyticsConnector } from '../src/connectors/adapters/google-analytics.js'
import { validateConnectorManifest } from '../src/connectors/types.js'

describe('google-analytics adapter manifest', () => {
  it('classifies itself as a GA4 read-only analytics connector with kind=google-analytics', () => {
    expect(googleAnalyticsConnector.manifest.kind).toBe('google-analytics')
    expect(googleAnalyticsConnector.manifest.displayName).toBe('Google Analytics')
    expect(googleAnalyticsConnector.manifest.category).toBe('database')
    // Reports are cache-bias: the agent can re-query at will; results from a
    // 7-day window aren't "authoritative" in the GA Data API sense — the
    // backing data is eventually consistent and the connector is read-only.
    expect(googleAnalyticsConnector.manifest.defaultConsistencyModel).toBe('cache')
  })

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

  it('covers the GA4 Data API + Admin discovery surface (no writes — GA4 ingest is gtag/Measurement Protocol)', () => {
    const names = googleAnalyticsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'accountSummaries.list',
        'properties.get',
        'properties.metadata.get',
        'properties.runReport',
        'properties.batchRunReports',
        'properties.runPivotReport',
        'properties.runRealtimeReport',
        'properties.checkCompatibility',
      ].sort(),
    )
  })

  it('every capability is a read — GA4 has no write surface on the Data/Admin APIs we expose', () => {
    for (const cap of googleAnalyticsConnector.manifest.capabilities) {
      expect(cap.class).toBe('read')
    }
  })

  it('every read names the analytics.readonly scope so the policy layer can enforce per-capability grants', () => {
    for (const cap of googleAnalyticsConnector.manifest.capabilities) {
      expect(cap.requiredScopes).toEqual(['https://www.googleapis.com/auth/analytics.readonly'])
    }
  })

  it('runReport requires propertyId, metrics, and dateRanges — the GA4 Data API rejects any of these as missing', () => {
    const runReport = googleAnalyticsConnector.manifest.capabilities.find((c) => c.name === 'properties.runReport')
    if (!runReport) throw new Error('runReport capability missing')
    const params = runReport.parameters as { required?: string[] }
    expect(params.required).toEqual(expect.arrayContaining(['propertyId', 'metrics', 'dateRanges']))
  })

  it('realtime report does NOT require dateRanges — the 30-minute window is implicit on the realtime endpoint', () => {
    const realtime = googleAnalyticsConnector.manifest.capabilities.find((c) => c.name === 'properties.runRealtimeReport')
    if (!realtime) throw new Error('runRealtimeReport capability missing')
    const params = realtime.parameters as { required?: string[] }
    expect(params.required).toEqual(['propertyId', 'metrics'])
  })

  it('only ships a read handler — no executeMutation because there are no mutations', () => {
    expect(typeof googleAnalyticsConnector.executeRead).toBe('function')
    expect(typeof googleAnalyticsConnector.executeMutation).toBe('function')
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(googleAnalyticsConnector.manifest)).toEqual({ ok: true, issues: [] })
  })
})
