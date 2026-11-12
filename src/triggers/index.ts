/**
 * Hosted triggers: provider events for connectors whose provider cannot push
 * to a Hub without a customer configuring something, so the host reads the
 * connector on a schedule instead. Each trigger is defined once, here, over the
 * connector's own READ capabilities, and runs on any host that can invoke a
 * connection's reads (the Tangle Hub polls them for every subscribed
 * workflow). A run is a pure function of the reads and a cursor:
 *
 *   - the first poll after a subscription records a baseline and emits
 *     nothing, so turning a trigger on never replays history;
 *   - timestamp providers emit unseen records at or after the boundary; feed
 *     providers consume one page in provider order, at most {@link MAX_EVENTS_PER_POLL};
 *   - the cursor advances only past emitted records, so a capped or failed
 *     poll resumes where it stopped; feed pages are checkpointed before admission.
 *
 * Events are normalized: a stable `id` (the delivery id), the trigger's
 * `type`, when the record was created, the person it names (email, name,
 * company) when there is one, a one-line summary and the trimmed record.
 * Providers that push signed webhooks keep their webhook provider in
 * `../webhooks`; a trigger here never duplicates one.
 */

import type { TriggerEventCatalog } from '../webhooks/router.js'
import { HOSTED_TRIGGER_DEFINITIONS } from './definitions.js'
import type { HostedTriggerCursor, HostedTriggerDefinition, HostedTriggerEvent, HostedTriggerRead } from './types.js'

export type * from './types.js'
export { HOSTED_TRIGGER_DEFINITIONS }

export const MAX_EVENTS_PER_POLL = 50
// Refuse an unbounded timestamp tie instead of forgetting IDs and replaying its first page.
const MAX_BOUNDARY_KEYS = 10_000

export interface HostedTriggerPollResult {
  events: HostedTriggerEvent[]
  cursor: HostedTriggerCursor
  /** True when more new records remain than one poll emits. */
  more: boolean
}

/** Poll one subscription once. `cursor` is null on the first poll after it is created. */
export async function pollHostedTrigger(
  trigger: HostedTriggerDefinition,
  context: {
    read: HostedTriggerRead; cursor: HostedTriggerCursor | null; now: Date
    /** Durably retain a pending page BEFORE returning its events. Required for provider progress. */
    checkpoint?: (cursor: HostedTriggerCursor) => Promise<void>
  },
): Promise<HostedTriggerPollResult> {
  if (!context.cursor) {
    const state = await trigger.initialize?.({ read: context.read, now: context.now })
    return { events: [], cursor: { since: context.now.toISOString(), seen: [], ...(state === undefined ? {} : { state }) }, more: false }
  }
  const cursor = context.cursor
  const sinceMs = Date.parse(cursor.since)
  if (!Number.isFinite(sinceMs) || !Array.isArray(cursor.seen) || cursor.seen.some((key) => typeof key !== 'string')) {
    throw new Error(`${trigger.event}: invalid cursor; refusing to reset its baseline`)
  }
  const seen = new Set(cursor.seen)
  const page: { next?: { state: unknown; more: boolean; checkpoint: unknown } } = {}
  const records = await trigger.list({
    read: context.read, since: cursor.since, now: context.now,
    progress: { state: cursor.state, limit: MAX_EVENTS_PER_POLL, set(next) {
      if (page.next) throw new Error(`${trigger.event}: more than one page per poll`)
      page.next = next
    } },
  })
  const progress = page.next
  if (progress) {
    if (!context.checkpoint) throw new Error(`${trigger.event}: durable page checkpoint required before admission`)
    if (records.length > MAX_EVENTS_PER_POLL || new Set(records.map((record) => record.key)).size !== records.length ||
      records.some((record) => !record.key || !Number.isFinite(Date.parse(record.occurredAt)))) {
      throw new Error(`${trigger.event}: invalid or oversized provider page`)
    }
    await context.checkpoint({ ...cursor, state: progress.checkpoint })
    return {
      events: records.map((record) => ({ id: `${trigger.provider}:${record.key}`, type: trigger.event,
        occurredAt: new Date(Date.parse(record.occurredAt)).toISOString(), person: record.person, summary: record.summary, record: record.record })),
      cursor: { ...cursor, state: progress.state }, more: progress.more,
    }
  }
  const fresh = records
    .filter((record) => !seen.has(record.key) && Number.isFinite(Date.parse(record.occurredAt)) && Date.parse(record.occurredAt) >= sinceMs)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
  const emitted = fresh.slice(0, MAX_EVENTS_PER_POLL)
  const since = emitted.reduce((latest, record) => Date.parse(record.occurredAt) > Date.parse(latest) ? new Date(Date.parse(record.occurredAt)).toISOString() : latest, cursor.since)
  const keys = [...new Set([
    ...(since === cursor.since ? cursor.seen : []),
    ...emitted.filter((record) => Date.parse(record.occurredAt) === Date.parse(since)).map((record) => record.key),
  ])]
  if (keys.length > MAX_BOUNDARY_KEYS) throw new Error(`${trigger.event}: timestamp boundary exceeds retained-key capacity; cursor retained`)
  return {
    events: emitted.map((record) => ({
      id: `${trigger.provider}:${record.key}`,
      type: trigger.event,
      occurredAt: new Date(Date.parse(record.occurredAt)).toISOString(),
      person: record.person,
      summary: record.summary,
      record: record.record,
    })),
    cursor: { since, seen: keys },
    more: fresh.length > emitted.length,
  }
}

export function hostedTrigger(provider: string, event: string): HostedTriggerDefinition | undefined {
  return HOSTED_TRIGGER_DEFINITIONS.find((trigger) => trigger.provider === provider && trigger.event === event)
}

/** Providers with at least one hosted trigger. */
export const HOSTED_TRIGGER_PROVIDER_IDS: readonly string[] = [...new Set(HOSTED_TRIGGER_DEFINITIONS.map((trigger) => trigger.provider))]

/** The closed catalog of a provider's hosted trigger events, for validating `on.provider_event.event`. */
export function hostedTriggerEventCatalog(provider: string): TriggerEventCatalog | undefined {
  const events = HOSTED_TRIGGER_DEFINITIONS.filter((trigger) => trigger.provider === provider)
  if (events.length === 0) return undefined
  return { namespace: `${provider}.`, closed: true, events: events.map((trigger) => ({ id: trigger.event })) }
}
