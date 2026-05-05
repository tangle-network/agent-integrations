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
