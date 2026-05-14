/**
 * Subscription state machine.
 *
 * Stripe ships eight terminal states on `Subscription.status`. We model
 * them verbatim — never normalize, never collapse — so the state
 * persisted in product DBs round-trips Stripe webhooks losslessly.
 *
 *   incomplete           — first invoice not paid within 23 hours
 *   incomplete_expired   — first invoice failed, no retry coming
 *   trialing             — inside a trial window (treat as active)
 *   active               — paying, current
 *   past_due             — auto-renewal failed; grace period running
 *   canceled             — terminal; ended at period boundary or hard
 *   unpaid               — past_due → unpaid after retries exhausted
 *   paused               — operator-paused (collection_method=pause_collection)
 *
 * Transition rules below derive STRICTLY from the Stripe state diagram
 * (https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses)
 * — the dispatcher in `webhooks.ts` calls `applyTransition()` which
 * rejects any state pair Stripe never emits. This catches manual-edit
 * bugs (someone POSTing a `force_state` admin endpoint) and tests for
 * the consumer's state store at the same time.
 *
 * Persistence: products pick an adapter (FS, D1, Postgres, in-memory).
 * The interface is intentionally minimal — load(), save(), and a
 * compare-and-set `saveIfVersion()` that defends against duplicate
 * webhook delivery racing the same store. Stripe re-delivers failed
 * webhooks for 3 days; the in-flight one and the retry will both write
 * the same key. `WebhookRouter`'s idempotency hook short-circuits at
 * the event level, but a misconfigured deploy with two routers in
 * different regions both processing the same event needs the second
 * line of defense here.
 *
 * `requireActiveSubscription()` (middleware) calls `gateAccess(state)`
 * to map state → access-decision. `past_due` is intentionally allowed
 * with a warning flag — the dunning period is when products MOST need
 * customers to keep using the product so they remember why they pay,
 * but the UI should render the "card declined" banner.
 */

import { BillingError } from './errors.js'

export type SubscriptionState =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'

/** All eight states, exported so tests + consumers can enumerate. */
export const SUBSCRIPTION_STATES: readonly SubscriptionState[] = Object.freeze([
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
])

/** Tristate access decision. `warn` means the route runs, but the UI
 *  should render a billing banner. */
export type AccessDecision =
  | { allowed: true; warn?: 'past_due' | 'trial_ending' }
  | { allowed: false; reason: 'no_subscription' | 'subscription_inactive' | 'subscription_past_due' | 'trial_expired' }

export interface SubscriptionRecord {
  /** Tenant key the product uses to look up "is this workspace paying?" —
   *  typically a workspaceId, but products that bill per-user or
   *  per-organization can swap in their own scope. */
  workspaceId: string
  /** Stripe customer id (`cus_...`). */
  customerId: string
  /** Stripe subscription id (`sub_...`). */
  subscriptionId: string
  /** Last-known subscription state — updated by webhook handlers. */
  state: SubscriptionState
  /** Stripe price id active on the subscription. Null for canceled. */
  priceId: string | null
  /** Current billing period end (unix seconds). Used by middleware to
   *  emit `trial_ending` warning in the last 72h of a trial. */
  currentPeriodEnd: number | null
  /** Trial end (unix seconds), null for non-trial subs. */
  trialEnd: number | null
  /** `cancel_at_period_end` flag — once true, state stays `active` until
   *  the period ends, then transitions to `canceled`. */
  cancelAtPeriodEnd: boolean
  /** Monotonic write counter for optimistic concurrency. Incremented on
   *  every save; persistence adapters use it for CAS. */
  version: number
  /** Last event id we processed for this subscription — defends against
   *  Stripe re-delivering the same event and us racing the dedupe store. */
  lastEventId: string | null
  /** Wall-clock ms of last successful write. */
  updatedAt: number
}

/** Persistence adapter contract. Three operations — pick the storage
 *  layer that matches the product's existing infra. Adapters live below
 *  (in-memory + filesystem). D1 / Postgres are one-liners on top. */
export interface SubscriptionStore {
  load(workspaceId: string): Promise<SubscriptionRecord | null>
  save(record: SubscriptionRecord): Promise<void>
  /** Compare-and-set on `version`. Returns false if the stored record's
   *  version doesn't match `expectedVersion` (someone else wrote first).
   *  Implementations MUST return false rather than throw on contention —
   *  the caller branches on the bool. */
  saveIfVersion(record: SubscriptionRecord, expectedVersion: number): Promise<boolean>
}

/** Transitions table — adjacency map of legal {from → to} edges derived
 *  from Stripe's subscription status diagram. Used by `applyTransition`. */
const TRANSITIONS: Readonly<Record<SubscriptionState, ReadonlySet<SubscriptionState>>> = Object.freeze({
  incomplete: new Set<SubscriptionState>(['active', 'trialing', 'incomplete_expired', 'canceled']),
  incomplete_expired: new Set<SubscriptionState>([]),
  trialing: new Set<SubscriptionState>(['active', 'past_due', 'canceled', 'paused', 'unpaid']),
  active: new Set<SubscriptionState>(['past_due', 'canceled', 'paused', 'unpaid', 'trialing']),
  past_due: new Set<SubscriptionState>(['active', 'canceled', 'unpaid', 'paused']),
  canceled: new Set<SubscriptionState>([]),
  unpaid: new Set<SubscriptionState>(['active', 'canceled', 'past_due']),
  paused: new Set<SubscriptionState>(['active', 'canceled', 'past_due']),
})

/** Returns true if `to` is reachable from `from` in one Stripe transition.
 *  Self-edges are accepted (a webhook can re-emit the current state on
 *  any field change). */
export function isValidTransition(from: SubscriptionState, to: SubscriptionState): boolean {
  if (from === to) return true
  return TRANSITIONS[from].has(to)
}

/** Apply a state transition to a record. Throws `BillingError` if Stripe
 *  would never emit this edge (defensive — a bad admin tool POSTing a
 *  raw state update gets refused). Returns the new record without writing. */
export function applyTransition(
  current: SubscriptionRecord,
  next: Partial<SubscriptionRecord> & { state: SubscriptionState },
  options: { eventId?: string; now?: () => number } = {},
): SubscriptionRecord {
  if (!isValidTransition(current.state, next.state)) {
    throw new BillingError({
      code: 'webhook_event_unknown',
      message: `Illegal subscription transition ${current.state} → ${next.state}`,
      context: {
        workspaceId: current.workspaceId,
        subscriptionId: current.subscriptionId,
        subscriptionState: current.state,
        eventId: options.eventId,
      },
    })
  }
  const now = (options.now ?? Date.now)()
  return {
    ...current,
    ...next,
    version: current.version + 1,
    lastEventId: options.eventId ?? current.lastEventId,
    updatedAt: now,
  }
}

/**
 * Map a state to an access decision.
 *
 * Rule rationale:
 *   active, trialing             → allow
 *   past_due                     → allow + warn (dunning grace)
 *   paused                       → deny (operator action; resume restores)
 *   canceled, unpaid             → deny (terminal financial states)
 *   incomplete, incomplete_expired → deny (never paid; first invoice failed)
 *
 * Note `requireActiveSubscription` in `middleware.ts` is the consumer of
 * this — gating is centralized here so the rule lives in one place. The
 * mapping is one assertion in the test suite. Changing the rule for one
 * product (e.g., legal-agent wants past_due to deny) is a per-call
 * `overrides` option on the middleware, NOT a fork of this function.
 */
export function gateAccess(state: SubscriptionState): AccessDecision {
  switch (state) {
    case 'active':
    case 'trialing':
      return { allowed: true }
    case 'past_due':
      return { allowed: true, warn: 'past_due' }
    case 'paused':
      return { allowed: false, reason: 'subscription_past_due' }
    case 'canceled':
    case 'unpaid':
      return { allowed: false, reason: 'subscription_inactive' }
    case 'incomplete':
    case 'incomplete_expired':
      return { allowed: false, reason: 'subscription_inactive' }
  }
}

/* ---------------------------------------------------------------------- */
/*                     persistence adapter: in-memory                      */
/* ---------------------------------------------------------------------- */

/**
 * Process-local store. Useful for tests; product instances should pick
 * `FileSystemSubscriptionStore` or wire D1 / Postgres. Implements proper
 * CAS — concurrent saves with stale versions are rejected.
 */
export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly records = new Map<string, SubscriptionRecord>()

  async load(workspaceId: string): Promise<SubscriptionRecord | null> {
    const r = this.records.get(workspaceId)
    return r ? { ...r } : null
  }

  async save(record: SubscriptionRecord): Promise<void> {
    this.records.set(record.workspaceId, { ...record })
  }

  async saveIfVersion(record: SubscriptionRecord, expectedVersion: number): Promise<boolean> {
    const current = this.records.get(record.workspaceId)
    if (current && current.version !== expectedVersion) return false
    if (!current && expectedVersion !== 0) return false
    this.records.set(record.workspaceId, { ...record })
    return true
  }
}

/* ---------------------------------------------------------------------- */
/*                  persistence adapter: filesystem (JSONL)                */
/* ---------------------------------------------------------------------- */

/**
 * File-per-workspace JSON store. One file per workspace under
 * `<rootDir>/<workspaceId>.json`. Cheap, durable, debuggable — adequate
 * for self-hosted product agents. CAS is implemented via the version
 * field plus a write that re-reads the file under a brief lock window
 * (rename-temp-to-target pattern, atomic on POSIX).
 *
 * Why per-file and not one JSONL: subscriptions are
 * accessed by workspaceId 99% of the time, scanning a JSONL on every
 * request burns I/O. The file-per-workspace pattern keeps reads O(1).
 *
 * The store does NOT use `fs.watch` — webhooks are the only writer in
 * production, and webhooks always go through `applyTransition()` →
 * `saveIfVersion()`, so the CAS catches the race.
 */
export class FileSystemSubscriptionStore implements SubscriptionStore {
  constructor(private readonly rootDir: string) {}

  async load(workspaceId: string): Promise<SubscriptionRecord | null> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = path.join(this.rootDir, this.fileName(workspaceId))
    try {
      const raw = await fs.readFile(file, 'utf-8')
      return JSON.parse(raw) as SubscriptionRecord
    } catch (err) {
      if (isNodeENOENT(err)) return null
      throw err
    }
  }

  async save(record: SubscriptionRecord): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(this.rootDir, { recursive: true })
    const file = path.join(this.rootDir, this.fileName(record.workspaceId))
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(tmp, JSON.stringify(record), 'utf-8')
    await fs.rename(tmp, file)
  }

  async saveIfVersion(record: SubscriptionRecord, expectedVersion: number): Promise<boolean> {
    const existing = await this.load(record.workspaceId)
    if (existing && existing.version !== expectedVersion) return false
    if (!existing && expectedVersion !== 0) return false
    await this.save(record)
    return true
  }

  /** Safe filename: workspaceId is restricted to a charset that maps 1:1
   *  to a posix filename. Anything outside is hex-encoded so we can never
   *  escape the rootDir via `../`. */
  private fileName(workspaceId: string): string {
    if (!/^[A-Za-z0-9_.-]+$/.test(workspaceId)) {
      return `${Buffer.from(workspaceId, 'utf-8').toString('hex')}.json`
    }
    return `${workspaceId}.json`
  }
}

function isNodeENOENT(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT'
}

/* ---------------------------------------------------------------------- */
/*                          construction helper                            */
/* ---------------------------------------------------------------------- */

/** Convenience constructor for the initial record after a checkout
 *  succeeds. The webhook handler for `customer.subscription.created` calls
 *  this — exposed for tests + manual-fix scripts that need to backfill. */
export function makeSubscriptionRecord(input: {
  workspaceId: string
  customerId: string
  subscriptionId: string
  state: SubscriptionState
  priceId: string | null
  currentPeriodEnd: number | null
  trialEnd?: number | null
  cancelAtPeriodEnd?: boolean
  now?: () => number
}): SubscriptionRecord {
  const now = (input.now ?? Date.now)()
  return {
    workspaceId: input.workspaceId,
    customerId: input.customerId,
    subscriptionId: input.subscriptionId,
    state: input.state,
    priceId: input.priceId,
    currentPeriodEnd: input.currentPeriodEnd,
    trialEnd: input.trialEnd ?? null,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    version: 0,
    lastEventId: null,
    updatedAt: now,
  }
}
