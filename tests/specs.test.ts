import { describe, expect, it } from 'vitest'
import {
  buildHealthcheckPlan,
  getIntegrationSpec,
  integrationSpecToConnector,
  listExecutableIntegrationSpecs,
  listIntegrationCoverageSpecs,
  listIntegrationSpecs,
  renderAgentToolDescription,
  renderConsoleSteps,
  renderRunbookMarkdown,
  validateCredentialFormat,
  validateIntegrationSpec,
} from '../src/index'

describe('integration specs', () => {
  it('derives one setup spec per coverage catalog entry', () => {
    const specs = listIntegrationSpecs()
    expect(specs).toHaveLength(listIntegrationCoverageSpecs().length)
    expect(new Set(specs.map((spec) => spec.kind)).size).toBe(specs.length)
    expect(specs.length).toBeGreaterThanOrEqual(140)
  })

  it('models executable OAuth and API-key connectors without conflating auth modes', () => {
    const google = getIntegrationSpec('google-calendar')
    const github = getIntegrationSpec('github')
    const webhook = getIntegrationSpec('webhook')

    expect(google?.status).toBe('executable')
    expect(google?.auth.mode).toBe('oauth2')
    expect(google?.permissions.some((p) => p.providerScopes.includes('https://www.googleapis.com/auth/calendar'))).toBe(true)

    expect(github?.status).toBe('executable')
    expect(github?.auth.mode).toBe('api_key')

    expect(webhook?.status).toBe('executable')
    expect(webhook?.auth.mode).toBe('hmac')
  })

  it('renders setup surfaces from the same spec source', () => {
    const spec = getIntegrationSpec('google-calendar')
    expect(spec).toBeDefined()
    const steps = renderConsoleSteps(spec!, { host: 'builder.example.com' })
    const markdown = renderRunbookMarkdown(spec!, { host: 'builder.example.com' })
    const toolDescription = renderAgentToolDescription(spec!)

    expect(steps.some((step) => step.detail.includes('builder.example.com'))).toBe(true)
    expect(markdown).toContain('# Google Calendar Integration Setup')
    expect(markdown).toContain('https://builder.example.com/api/integrations/oauth/google/callback')
    expect(toolDescription).toContain('Google Calendar')
  })

  it('validates specs, credential formats, healthchecks, and connector conversion', () => {
    const spec = getIntegrationSpec('salesforce')
    expect(spec).toBeDefined()
    expect(validateIntegrationSpec(spec!).ok).toBe(true)
    expect(buildHealthcheckPlan(spec!).requires).toContain('connection_credentials')

    const connector = integrationSpecToConnector(spec!, 'first-party')
    expect(connector.auth).toBe('oauth2')
    expect(connector.actions.length).toBeGreaterThan(0)

    const field = spec!.setup.credentialFields.find((f) => !f.secret)
    expect(field).toBeDefined()
    expect(validateCredentialFormat(field!, 'abc').ok).toBe(true)
  })

  it('keeps executable coverage explicit and bounded', () => {
    const executable = listExecutableIntegrationSpecs().map((spec) => spec.kind).sort()
    expect(executable).toEqual(expect.arrayContaining([
      'airtable',
      'asana',
      'github',
      'google-calendar',
      'google-sheets',
      'hubspot',
      'microsoft-calendar',
      'salesforce',
      'slack',
    ]))
    expect(executable.length).toBeGreaterThanOrEqual(12)
    expect(getIntegrationSpec('gmail')?.status).toBe('catalog')
  })
})

describe('integration overrides — per-kind setup richness', () => {
  it('stripe-pack carries restricted-key guidance + dashboard URL', () => {
    const spec = getIntegrationSpec('stripe-pack')
    expect(spec).toBeDefined()
    expect(spec!.setup.consoleUrl).toBe('https://dashboard.stripe.com/apikeys')
    expect(spec!.setup.credentialFields).toHaveLength(1)
    const f = spec!.setup.credentialFields[0]
    expect(f.label).toMatch(/Stripe secret key/i)
    expect(f.description).toMatch(/restricted key/i)
    expect(f.regex).toBeDefined()
    // The provided regex matches both live + test secrets/restricted keys.
    expect(validateCredentialFormat(f, 'sk_live_abc123').ok).toBe(true)
    expect(validateCredentialFormat(f, 'rk_live_abc123').ok).toBe(true)
    expect(validateCredentialFormat(f, 'pk_live_abc123').ok).toBe(false) // publishable rejected
  })

  it('twilio-sms exposes a two-field credential set (Account SID + Auth Token)', () => {
    const spec = getIntegrationSpec('twilio-sms')
    expect(spec).toBeDefined()
    const fields = spec!.setup.credentialFields
    expect(fields).toHaveLength(2)
    const sid = fields.find((f) => f.label.includes('Account SID'))
    const token = fields.find((f) => f.label.includes('Auth Token'))
    expect(sid).toBeDefined()
    expect(token).toBeDefined()
    expect(sid!.secret).toBe(false)
    expect(token!.secret).toBe(true)
    // Account SID regex enforces AC-prefixed 32-hex format
    expect(validateCredentialFormat(sid!, 'AC' + 'a'.repeat(32)).ok).toBe(true)
    expect(validateCredentialFormat(sid!, 'XX' + 'a'.repeat(32)).ok).toBe(false)
  })

  it('twilio-sms surfaces the subaccount-tokens quirk via the override layer', () => {
    const spec = getIntegrationSpec('twilio-sms')
    const quirks = spec!.setup.knownQuirks ?? []
    expect(quirks.some((q) => q.id === 'subaccount-tokens')).toBe(true)
  })

  it('kinds without overrides fall through to family defaults', () => {
    // gmail has no override; should use the google family's default fields
    // (Client ID + Client Secret) and the Google Cloud Console URL.
    const spec = getIntegrationSpec('gmail')
    expect(spec!.setup.consoleUrl).toBe('https://console.cloud.google.com/apis/credentials')
    expect(spec!.setup.credentialFields).toHaveLength(2)
    expect(spec!.setup.credentialFields[0].label).toMatch(/client id/i)
  })
})
