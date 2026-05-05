import {
  CANONICAL_INTEGRATION_ACTIONS,
  buildIntegrationBridgeEnvironment,
  calendarExercisePlannerManifest,
  createTangleIntegrationsClient,
  renderConsentSummary,
  type IntegrationSandboxBundle,
} from '../src/index.js'

const manifest = calendarExercisePlannerManifest()
const consent = renderConsentSummary(manifest, { appName: 'Exercise Planner' })

console.log(consent.body)

// In production this bundle comes from id.tangle.tools after the user grants
// the generated app access to their Google Calendar connection.
const bundle: IntegrationSandboxBundle = {
  manifestId: manifest.id,
  subject: { type: 'sandbox', id: 'sandbox_preview_1' },
  connectors: [],
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  capabilities: [{
    requirementId: 'calendar-read',
    connectorId: 'google-calendar',
    connectionId: 'conn_google_calendar',
    grantId: 'grant_calendar_read',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    allowedActions: [CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList],
    allowedTriggers: [],
    capability: {
      capability: {
        id: 'cap_calendar_read',
        subject: { type: 'sandbox', id: 'sandbox_preview_1' },
        connectionId: 'conn_google_calendar',
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        allowedActions: [CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList],
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      },
      token: 'short-lived-capability-token',
    },
  }],
  tools: [{
    name: 'google_calendar_events_list',
    title: 'Google Calendar: List calendar events',
    description: 'Read events from a Google Calendar over a bounded time range.',
    providerId: 'tangle-platform',
    connectorId: 'google-calendar',
    connectorTitle: 'Google Calendar',
    category: 'calendar',
    action: {
      id: CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList,
      title: 'List calendar events',
      risk: 'read',
      requiredScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      dataClass: 'private',
    },
    risk: 'read',
    dataClass: 'private',
    requiredScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    tags: ['google', 'calendar', 'events', 'list'],
  }],
}

const env = buildIntegrationBridgeEnvironment(bundle)
const client = createTangleIntegrationsClient({
  endpoint: 'https://id.tangle.tools',
  env,
})

await client.invoke({
  tool: CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList,
  input: {
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
  },
})
