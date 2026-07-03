/**
 * Trigger-event catalog drift guard. The catalog a consumer validates workflow
 * `provider_event` triggers against MUST agree with what `parse()` actually
 * emits — otherwise a real event gets rejected, or a dead one accepted. These
 * tests pin the two together: catalog shape invariants, the namespace holding
 * against live parse output, and the `closed` (Telegram) catalog being exactly
 * the set `parse` can produce.
 */

import { describe, expect, it } from 'vitest'
import * as webhooks from '../src/webhooks/index'
import {
  docusealWebhookProvider,
  hellosignWebhookProvider,
  slackWebhookProvider,
  stripeWebhookProvider,
  telegramWebhookProvider,
  type WebhookProvider,
} from '../src/webhooks/index'

/** A value from the webhooks barrel that is a WebhookProvider. */
function isWebhookProvider(v: unknown): v is WebhookProvider {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { id?: unknown }).id === 'string' &&
    typeof (v as { verifySignature?: unknown }).verifySignature === 'function' &&
    typeof (v as { parse?: unknown }).parse === 'function'
  )
}

// EVERY exported webhook provider, discovered dynamically so a new provider is
// covered by the invariants below without editing this test.
const ALL_PROVIDERS: WebhookProvider[] = Object.values(webhooks).filter(isWebhookProvider)

// Providers the platform wires as workflow `provider_event` sources. These MUST
// declare a catalog — without one their triggers can never be author-time
// validated. Kept explicit so dropping a catalog from a wired provider fails
// here loudly, while a non-event provider (gmail/gdrive push, generic HMAC) may
// legitimately have none.
const EVENT_SOURCE_PROVIDER_IDS = ['stripe', 'slack', 'docuseal', 'telegram', 'hellosign']

describe('event catalog — shape invariants', () => {
  // Assert every provider that DECLARES a catalog declares a well-formed one —
  // catalog is optional, so a provider without one is skipped, not failed.
  for (const provider of ALL_PROVIDERS) {
    const catalog = provider.eventCatalog
    if (!catalog) continue
    it(`${provider.id}: declares a well-formed catalog`, () => {
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

  // Coverage guard: a provider the platform routes workflow events through must
  // carry a catalog, or its triggers silently skip validation.
  for (const id of EVENT_SOURCE_PROVIDER_IDS) {
    it(`${id}: is a wired event source and declares a catalog`, () => {
      const provider = ALL_PROVIDERS.find((p) => p.id === id)
      expect(provider, `no exported webhook provider with id "${id}"`).toBeDefined()
      expect(
        provider?.eventCatalog,
        `wired event-source provider "${id}" must declare an eventCatalog`,
      ).toBeDefined()
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
