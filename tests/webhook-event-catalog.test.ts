/**
 * Trigger-event catalog drift guard. The catalog a consumer validates workflow
 * `provider_event` triggers against MUST agree with what `parse()` actually
 * emits — otherwise a real event gets rejected, or a dead one accepted. These
 * tests pin the two together: catalog shape invariants, the namespace holding
 * against live parse output, and the `closed` (Telegram) catalog being exactly
 * the set `parse` can produce.
 */

import { describe, expect, it } from 'vitest'
import {
  docusealWebhookProvider,
  hellosignWebhookProvider,
  slackWebhookProvider,
  stripeWebhookProvider,
  telegramWebhookProvider,
  type WebhookProvider,
} from '../src/webhooks/index'

const PROVIDERS: WebhookProvider[] = [
  stripeWebhookProvider,
  slackWebhookProvider,
  docusealWebhookProvider,
  telegramWebhookProvider,
  hellosignWebhookProvider,
]

describe('event catalog — shape invariants', () => {
  for (const provider of PROVIDERS) {
    it(`${provider.id}: declares a well-formed catalog`, () => {
      const catalog = provider.eventCatalog
      expect(catalog, `${provider.id} must declare an eventCatalog`).toBeDefined()
      if (!catalog) return
      expect(catalog.events.length).toBeGreaterThan(0)
      // No duplicate ids.
      const ids = catalog.events.map((e) => e.id)
      expect(new Set(ids).size).toBe(ids.length)
      // Every declared event carries the namespace (when the provider has one).
      if (catalog.namespace !== null) {
        for (const id of ids) {
          expect(id.startsWith(catalog.namespace)).toBe(true)
        }
      }
    })
  }
})

describe('event catalog — namespace holds against parse()', () => {
  async function eventTypeOf(
    provider: WebhookProvider,
    rawBody: string,
  ): Promise<string> {
    const [env] = await provider.parse({ rawBody, headers: {} })
    return env.eventType
  }

  it('slack: parsed event carries the declared namespace', async () => {
    const eventType = await eventTypeOf(
      slackWebhookProvider,
      JSON.stringify({ type: 'event_callback', event: { type: 'app_mention' } }),
    )
    expect(eventType).toBe('slack.app_mention')
    expect(eventType.startsWith(slackWebhookProvider.eventCatalog!.namespace!)).toBe(true)
  })

  it('docuseal: parsed event carries the declared namespace', async () => {
    const eventType = await eventTypeOf(
      docusealWebhookProvider,
      JSON.stringify({ event_type: 'form.completed' }),
    )
    expect(eventType).toBe('docuseal.form.completed')
    expect(eventType.startsWith(docusealWebhookProvider.eventCatalog!.namespace!)).toBe(true)
  })

  it('hellosign: parsed event carries the declared namespace', async () => {
    const eventType = await eventTypeOf(
      hellosignWebhookProvider,
      JSON.stringify({ event: { event_type: 'signature_request_signed' } }),
    )
    expect(eventType).toBe('hellosign.signature_request_signed')
    expect(eventType.startsWith(hellosignWebhookProvider.eventCatalog!.namespace!)).toBe(true)
  })

  it('stripe: raw event type, no namespace to enforce', async () => {
    const eventType = await eventTypeOf(
      stripeWebhookProvider,
      JSON.stringify({ id: 'evt_1', type: 'charge.succeeded' }),
    )
    expect(eventType).toBe('charge.succeeded')
    expect(stripeWebhookProvider.eventCatalog!.namespace).toBeNull()
  })
})

describe('telegram — closed catalog is exactly what parse can emit', () => {
  const catalog = telegramWebhookProvider.eventCatalog!
  const catalogIds = new Set(catalog.events.map((e) => e.id))

  it('is closed and namespaced', () => {
    expect(catalog.closed).toBe(true)
    expect(catalog.namespace).toBe('telegram.')
  })

  it('every update kind parse recognizes is a catalog member', async () => {
    // Drive parse with one update per declared kind; each must round-trip to a
    // catalog id. This is the drift guard: parse derives the kind from the same
    // TELEGRAM_UPDATE_KEYS the catalog is built from, so any divergence fails here.
    for (const { id } of catalog.events) {
      const kind = id.slice('telegram.'.length)
      const [env] = await telegramWebhookProvider.parse({
        rawBody: JSON.stringify({ update_id: 1, [kind]: {} }),
        headers: {},
      })
      expect(env.eventType).toBe(id)
      expect(catalogIds.has(env.eventType)).toBe(true)
    }
  })

  it('an unrecognized update falls back to telegram.unknown, which is NOT triggerable', async () => {
    const [env] = await telegramWebhookProvider.parse({
      rawBody: JSON.stringify({ update_id: 1, not_a_real_update: {} }),
      headers: {},
    })
    expect(env.eventType).toBe('telegram.unknown')
    expect(catalogIds.has('telegram.unknown')).toBe(false)
  })
})
