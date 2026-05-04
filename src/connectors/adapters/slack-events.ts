/**
 * Slack Events API inbound receiver.
 *
 * Slack sends two distinct request shapes to the same webhook URL:
 *
 *   1. `url_verification` — a one-off handshake during app-config. The body
 *      contains a `challenge` string we MUST echo back as the response body
 *      (Slack's app-config UI fails the URL otherwise). No InboundEvent is
 *      persisted for this — it's an infrastructure ping, not a user event.
 *
 *   2. `event_callback` — every actual workspace event (message posted,
 *      reaction added, channel created, …). We persist one InboundEvent
 *      keyed by `event_id` so a Slack retry (Slack retries 3 times on any
 *      non-2xx) is deduped at the unique constraint, not after we've
 *      double-processed.
 *
 * Signature scheme: `v0=<hmac(sha256, "v0:<timestamp>:<rawBody>")>` keyed by
 * the app's signing secret. Header `X-Slack-Request-Timestamp` carries the
 * timestamp; we reject anything older than 5 minutes (Slack's recommendation)
 * to bound replay risk.
 */

import {
  type ConnectorAdapter,
  type EventHandlerResult,
  type InboundEvent,
} from '../types.js'
import { firstHeader, verifySlackSignature } from '../webhooks.js'

export const slackEventsConnector: ConnectorAdapter = {
  manifest: {
    // NOTE: `slack` is owned by the OAuth bot connector in slack.ts (post_message,
    // lookup_user, list_channels). This adapter is the HMAC-only inbound-events
    // sibling — distinct kind so a customer can stand up the Events API receiver
    // without granting bot OAuth, and so the registry doesn't reject duplicate
    // kinds at boot.
    kind: 'slack-inbound',
    displayName: 'Slack (Events API)',
    description:
      "Receive workspace events (messages, reactions, app mentions, …) from Slack's Events API. Outbound bot messaging will land in a follow-up.",
    auth: { kind: 'hmac' },
    category: 'comms',
    // Inbound-only. Events are advisory in this incarnation — agents observe
    // and react, no CAS.
    defaultConsistencyModel: 'advisory',
    capabilities: [],
  },

  verifySignature({ rawBody, headers, source }) {
    if (source.credentials.kind !== 'hmac') return { valid: false, reason: 'missing_hmac_secret' }
    const sig = firstHeader(headers, 'x-slack-signature')
    const ts = firstHeader(headers, 'x-slack-request-timestamp')
    if (!sig || !ts) return { valid: false, reason: 'missing_slack_headers' }
    const ok = verifySlackSignature(rawBody, sig, ts, source.credentials.secret)
    return ok ? { valid: true } : { valid: false, reason: 'invalid_signature' }
  },

  async handleInboundEvent({ rawBody }): Promise<EventHandlerResult> {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return { events: [], response: { status: 400, body: { error: 'invalid_json' } } }
    }
    if (!parsed || typeof parsed !== 'object') {
      return { events: [], response: { status: 400, body: { error: 'invalid_payload' } } }
    }
    const obj = parsed as Record<string, unknown>

    // Handshake: echo the challenge. No event persisted.
    if (obj.type === 'url_verification') {
      const challenge = typeof obj.challenge === 'string' ? obj.challenge : ''
      return {
        events: [],
        response: { status: 200, body: { challenge } },
      }
    }

    // Workspace event: persist one row keyed by Slack's event_id.
    if (obj.type === 'event_callback') {
      const inner = obj.event
      const innerType =
        inner && typeof inner === 'object' && 'type' in inner && typeof (inner as { type?: unknown }).type === 'string'
          ? (inner as { type: string }).type
          : 'slack.event'
      const providerEventId = typeof obj.event_id === 'string' ? obj.event_id : undefined
      const event: InboundEvent = {
        eventType: `slack.${innerType}`,
        providerEventId,
        payload: obj,
      }
      return { events: [event] }
    }

    // Unknown envelope (Slack adds new top-level types occasionally) — ack
    // so Slack stops retrying, but don't persist a malformed row.
    return { events: [] }
  },

  async test(source) {
    if (source.credentials.kind !== 'hmac' || !source.credentials.secret) {
      return { ok: false, reason: 'signing secret not configured' }
    }
    return { ok: true }
  },
}
