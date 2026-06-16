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
  resolveConnectorAuthSpec,
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

  it('resolves a connect-driving auth spec per provider from the spec catalog', () => {
    const google = resolveConnectorAuthSpec('google-calendar')
    expect(google).toMatchObject({
      kind: 'google-calendar',
      authKind: 'oauth2',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      pkce: 'supported',
    })
    expect(google!.requestedScopes).toContain('https://www.googleapis.com/auth/calendar')
    expect(google!.requestedScopes.every((scope) => scope.length > 0)).toBe(true)

    const github = resolveConnectorAuthSpec('github')
    expect(github).toEqual({ kind: 'github', authKind: 'api_key', requestedScopes: [] })

    const http = resolveConnectorAuthSpec('http')
    expect(http).toEqual({ kind: 'http', authKind: 'none', requestedScopes: [] })

    // hmac-family providers surface as 'custom' (not in the four hub-driveable
    // kinds the OAuth start path handles directly).
    const webhook = resolveConnectorAuthSpec('webhook')
    expect(webhook).toEqual({ kind: 'webhook', authKind: 'custom', requestedScopes: [] })

    expect(resolveConnectorAuthSpec('definitely-not-a-real-kind')).toBeUndefined()
  })

  it('resolves auth specs through kind aliases', () => {
    // 'notion-database' aliases to 'notion'; 'stripe' to 'stripe-pack'.
    expect(resolveConnectorAuthSpec('notion')?.kind).toBe('notion')
    expect(resolveConnectorAuthSpec('stripe')?.authKind).toBe('api_key')
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

  it('phony is an executable api-key connector with a plabs_ key field', () => {
    const spec = getIntegrationSpec('phony')
    expect(spec).toBeDefined()
    expect(spec!.status).toBe('executable')
    expect(spec!.auth.mode).toBe('api_key')
    expect(spec!.setup.credentialFields).toHaveLength(1)
    const key = spec!.setup.credentialFields[0]
    expect(key.secret).toBe(true)
    expect(key.regex).toBe('^plabs_[A-Za-z0-9_-]{32}$')
    // Real key shape: plabs_ + 32 url-safe nanoid chars.
    expect(validateCredentialFormat(key, 'plabs_V1StGXR8Z5jdHi6BmyTAbCdEfGhIjKlm').ok).toBe(true)
    // The earlier-sketched phony_live_ prefix is wrong and must be rejected.
    expect(validateCredentialFormat(key, 'phony_live_' + 'a'.repeat(32)).ok).toBe(false)
    expect(validateCredentialFormat(key, 'plabs_short').ok).toBe(false)
  })

  it('phony surfaces the key-shown-once + rotate quirks via the override layer', () => {
    const spec = getIntegrationSpec('phony')
    const quirks = spec!.setup.knownQuirks ?? []
    expect(quirks.some((q) => q.id === 'key-shown-once')).toBe(true)
    expect(quirks.some((q) => q.id === 'rotate-endpoint')).toBe(true)
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
