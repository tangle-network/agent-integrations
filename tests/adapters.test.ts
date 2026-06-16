import { describe, expect, it } from 'vitest'
import {
  docuseal,
  gmail,
  googleCalendar,
  googleDrive,
  googleSheets,
  hubspot,
  microsoftCalendar,
  notion,
  phonyConnector,
  slack,
  slackEventsConnector,
  stripePackConnector,
  stripeWebhookReceiverConnector,
  twilioSmsConnector,
  validateConnectorManifest,
  webhookConnector,
  type ConnectorAdapter,
} from '../src/connectors/index'

function adapters(): ConnectorAdapter[] {
  const oauth = { clientId: 'client_id', clientSecret: 'client_secret' }
  return [
    googleCalendar(oauth),
    googleDrive(oauth),
    googleSheets(oauth),
    gmail(oauth),
    microsoftCalendar(oauth),
    hubspot(oauth),
    notion(oauth),
    slack(oauth),
    docuseal(),
    twilioSmsConnector,
    phonyConnector,
    stripePackConnector,
    webhookConnector,
    stripeWebhookReceiverConnector,
    slackEventsConnector,
  ]
}

describe('first-party adapters', () => {
  it('ship valid connector manifests', () => {
    for (const adapter of adapters()) {
      const result = validateConnectorManifest(adapter.manifest)
      expect(result, adapter.manifest.kind).toEqual({ ok: true, issues: [] })
    }
  })

  it('only exposes executable surfaces declared in the manifest', () => {
    for (const adapter of adapters()) {
      const hasReads = adapter.manifest.capabilities.some((capability) => capability.class === 'read')
      const hasMutations = adapter.manifest.capabilities.some((capability) => capability.class === 'mutation')
      expect(Boolean(adapter.executeRead), `${adapter.manifest.kind} read handler`).toBe(hasReads)
      expect(Boolean(adapter.executeMutation), `${adapter.manifest.kind} mutation handler`).toBe(hasMutations)
    }
  })

  it('uses unique adapter kind ids', () => {
    const kinds = adapters().map((adapter) => adapter.manifest.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
  })
})
