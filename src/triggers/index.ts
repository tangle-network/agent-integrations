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
 *   - each later poll emits the records created at or after the cursor that it
 *     has not already emitted, oldest first, at most {@link MAX_EVENTS_PER_POLL};
 *   - the cursor advances only past emitted records, so a capped or failed
 *     poll resumes where it stopped.
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
const SEEN_KEYS = 200

export interface HostedTriggerPollResult {
  events: HostedTriggerEvent[]
  cursor: HostedTriggerCursor
  /** True when more new records remain than one poll emits. */
  more: boolean
}

/** Poll one subscription once. `cursor` is null on the first poll after it is created. */
export async function pollHostedTrigger(
  trigger: HostedTriggerDefinition,
  context: { read: HostedTriggerRead; cursor: HostedTriggerCursor | null; now: Date },
): Promise<HostedTriggerPollResult> {
  if (!context.cursor) return { events: [], cursor: { since: context.now.toISOString(), seen: [] }, more: false }
  const cursor = context.cursor
  const sinceMs = Date.parse(cursor.since)
  const seen = new Set(cursor.seen)
  const records = await trigger.list({ read: context.read, since: cursor.since, now: context.now })
  const fresh = records
    .filter((record) => !seen.has(record.key) && Number.isFinite(Date.parse(record.occurredAt)) && Date.parse(record.occurredAt) >= sinceMs)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
  const emitted = fresh.slice(0, MAX_EVENTS_PER_POLL)
  const since = emitted.reduce((latest, record) => Date.parse(record.occurredAt) > Date.parse(latest) ? new Date(Date.parse(record.occurredAt)).toISOString() : latest, cursor.since)
  const keys = [...cursor.seen.filter((key) => !emitted.some((record) => record.key === key)), ...emitted.map((record) => record.key)]
  return {
    events: emitted.map((record) => ({
      id: `${trigger.provider}:${record.key}`,
      type: trigger.event,
      occurredAt: new Date(Date.parse(record.occurredAt)).toISOString(),
      person: record.person,
      summary: record.summary,
      record: record.record,
    })),
    cursor: { since, seen: keys.slice(-SEEN_KEYS) },
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
