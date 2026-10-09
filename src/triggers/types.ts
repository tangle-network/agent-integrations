/** Types for hosted triggers; see `./index.ts` for the runtime contract. */

export interface HostedTriggerPerson {
  email: string | null
  name: string | null
  company: string | null
}

export interface HostedTriggerEvent {
  /** Stable across polls: the delivery id a host deduplicates on. */
  id: string
  /** The trigger's event id, e.g. `typeform.response.submitted`. */
  type: string
  /** ISO-8601 time the record was created upstream. */
  occurredAt: string
  person: HostedTriggerPerson | null
  summary: string
  /** The record trimmed to the fields a workflow needs. */
  record: Record<string, unknown>
}

export interface HostedTriggerCursor {
  /** ISO-8601 time: records created at or after it are new. */
  since: string
  /** Keys emitted at or near `since`, newest last, so a boundary record is never emitted twice. */
  seen: string[]
}

/** Run one READ capability of the trigger's connector on the subscribed connection; resolves to its data. */
export type HostedTriggerRead = (capability: string, args: Record<string, unknown>) => Promise<unknown>

export interface PolledRecord {
  key: string
  occurredAt: string
  person: HostedTriggerPerson | null
  summary: string
  record: Record<string, unknown>
}

export interface HostedTriggerDefinition {
  /** Connector kind, which is also the Hub provider id. */
  provider: string
  /** Event id, namespaced by the provider: `<provider>.<noun>.<verb>`. */
  event: string
  description: string
  /** Minimum seconds between polls of one subscription. */
  intervalSeconds: number
  /** Every capability `list` may read; each must be a READ on this connector. */
  reads: readonly string[]
  /** Candidate records created at or after `since`; the runner filters and orders them. */
  list(context: { read: HostedTriggerRead; since: string; now: Date }): Promise<PolledRecord[]>
}

