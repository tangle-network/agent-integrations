import { describe, expect, it } from 'vitest'
import {
  CANONICAL_INTEGRATION_ACTIONS,
  IntegrationRuntimeError,
  buildCanonicalLaunchConnectors,
  buildIntegrationBridgeEnvironment,
  calendarExercisePlannerManifest,
  createPlatformIntegrationPolicyPreset,
  createTangleIntegrationsClient,
  inferIntegrationManifestFromTools,
  normalizeIntegrationError,
  renderConsentSummary,
  validateIntegrationManifest,
  validateProviderPassthroughRequest,
  type IntegrationSandboxBundle,
} from '../src/index'

describe('platform-ready generated app primitives', () => {
  it('builds canonical launch connectors with schema-bearing actions', () => {
    const connectors = buildCanonicalLaunchConnectors()
    const calendar = connectors.find((connector) => connector.id === 'google-calendar')
    const action = calendar?.actions.find((candidate) => candidate.id === CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList)

    expect(calendar?.auth).toBe('oauth2')
    expect(action).toMatchObject({
      risk: 'read',
      dataClass: 'private',
      requiredScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    })
    expect(action?.inputSchema).toMatchObject({ type: 'object' })
  })

  it('infers and validates manifests from canonical tool plans', () => {
    const manifest = inferIntegrationManifestFromTools({
      manifestId: 'exercise-app',
      title: 'Exercise App',
      tools: [CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList],
    })
    const validation = validateIntegrationManifest(manifest)

    expect(validation.ok).toBe(true)
    expect(manifest.requirements).toEqual([{
      id: 'google-calendar-read',
      connectorId: 'google-calendar',
      mode: 'read',
      reason: 'Read calendar availability for the generated app.',
      requiredActions: [CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList],
      requiredScopes: undefined,
    }])
  })

  it('renders crisp consent copy for the calendar exercise app', () => {
    const summary = renderConsentSummary(calendarExercisePlannerManifest(), {
      appName: 'Exercise Planner',
      connectors: buildCanonicalLaunchConnectors(),
    })

    expect(summary.body).toBe('Exercise Planner wants to read your Google Calendar to find schedule-aware recommendations.')
    expect(summary.primaryAction).toBe('Allow access')
    expect(summary.risk).toBe('read')
  })

  it('invokes platform endpoint from bridge payload without exposing provider credentials', async () => {
    const env = buildIntegrationBridgeEnvironment(testBundle())
    const requests: unknown[] = []
    const client = createTangleIntegrationsClient({
      endpoint: 'https://id.tangle.tools',
      env,
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ status: 'ok', action: CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList, output: { events: [] } }), { status: 200 })
      },
    })

    const result = await client.invoke({
      tool: CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList,
      input: { calendarId: 'primary', timeMin: '2026-05-05T00:00:00Z', timeMax: '2026-05-06T00:00:00Z' },
      idempotencyKey: 'calendar-read-1',
    })

    expect(result.status).toBe('ok')
    expect(JSON.stringify(requests)).not.toContain('refresh')
    expect(requests[0]).toMatchObject({
      action: CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList,
      idempotencyKey: 'calendar-read-1',
    })
  })

  it('denies provider-native passthrough by default and normalizes UI errors', () => {
    expect(() => validateProviderPassthroughRequest({ method: 'GET', path: '/v1/me' }, { enabled: false }))
      .toThrow(IntegrationRuntimeError)

    const normalized = normalizeIntegrationError(new IntegrationRuntimeError({
      code: 'missing_connection',
      message: 'Connect Google Calendar.',
      userAction: { type: 'connect', label: 'Connect Google Calendar', connectorId: 'google-calendar' },
    }))

    expect(normalized).toMatchObject({
      ok: false,
      code: 'missing_connection',
      status: 409,
      userAction: { type: 'connect' },
    })
  })

  it('platform policy preset blocks passthrough and requires write approval', () => {
    const policy = createPlatformIntegrationPolicyPreset()
    const connection = {
      id: 'conn',
      owner: { type: 'user' as const, id: 'user' },
      providerId: 'platform',
      connectorId: 'google-calendar',
      status: 'active' as const,
      grantedScopes: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }

    const writeDecision = policy.decide({
      connection,
      subject: { type: 'sandbox', id: 'sandbox' },
      request: { connectionId: 'conn', action: CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsCreate },
      action: {
        id: CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsCreate,
        title: 'Create event',
        risk: 'write',
        requiredScopes: [],
        dataClass: 'private',
      },
    })
    const passthroughDecision = policy.decide({
      connection,
      subject: { type: 'sandbox', id: 'sandbox' },
      request: { connectionId: 'conn', action: CANONICAL_INTEGRATION_ACTIONS.providerHttpRequest },
      action: {
        id: CANONICAL_INTEGRATION_ACTIONS.providerHttpRequest,
        title: 'Provider HTTP request',
        risk: 'write',
        requiredScopes: [],
        dataClass: 'sensitive',
      },
    })

    expect(writeDecision.decision).toBe('require_approval')
    expect(passthroughDecision.decision).toBe('deny')
  })
})

function testBundle(): IntegrationSandboxBundle {
  return {
    manifestId: 'exercise-app',
    subject: { type: 'sandbox', id: 'sandbox' },
    connectors: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    capabilities: [{
      requirementId: 'calendar-read',
      connectorId: 'google-calendar',
      connectionId: 'conn_calendar',
      grantId: 'grant_calendar',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      allowedActions: [CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList],
      allowedTriggers: [],
      capability: {
        capability: {
          id: 'cap_calendar',
          subject: { type: 'sandbox', id: 'sandbox' },
          connectionId: 'conn_calendar',
          scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
          allowedActions: [CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList],
          issuedAt: new Date(0).toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        token: 'capability-token',
      },
    }],
    tools: [{
      name: 'calendar_tool',
      title: 'Calendar',
      description: 'Calendar',
      providerId: 'platform',
      connectorId: 'google-calendar',
      connectorTitle: 'Google Calendar',
      category: 'calendar',
      action: {
        id: CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList,
        title: 'List',
        risk: 'read',
        requiredScopes: [],
        dataClass: 'private',
      },
      risk: 'read',
      dataClass: 'private',
      requiredScopes: [],
      tags: [],
    }],
  }
}
