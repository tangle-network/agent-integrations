/**
 * Subscription state machine.
 *
 * Stripe ships eight terminal states on `Subscription.status`. We model
 * them verbatim — never normalize, never collapse — so the state
 * persisted in product DBs round-trips Stripe webhooks losslessly.
 *
 *   incomplete           — first invoice not paid within 23 hours
 *   incomplete_expired   — first invoice failed, no retry coming
 *   trialing             — inside a trial window (not product access)
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
  /** Stripe `event.created` for the newest applied subscription event. */
  lastEventCreatedAt: number | null
  /** State before the newest applied event. This lets a failed durable
   *  listener retry the exact typed update after the state write succeeded. */
  lastEventPreviousState?: SubscriptionState | null
  /** Event whose state is durable but whose listener has not completed.
   *  A different subscription event cannot advance until this is cleared. */
  pendingEventId?: string | null
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
  options: {
    eventId?: string
    eventCreatedAt?: number
    pendingEventId?: string | null
    now?: () => number
  } = {},
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
    lastEventCreatedAt: options.eventCreatedAt ?? current.lastEventCreatedAt,
    lastEventPreviousState: options.eventId ? current.state : (current.lastEventPreviousState ?? null),
    pendingEventId: options.pendingEventId !== undefined
      ? options.pendingEventId
      : (current.pendingEventId ?? null),
    updatedAt: now,
  }
}

/**
 * Map a state to an access decision.
 *
 * Rule rationale:
 *   active                       → allow
 *   trialing                     → deny (product-funded trials are disabled)
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
      return { allowed: true }
    case 'trialing':
      return { allowed: false, reason: 'trial_expired' }
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
/*                  persistence adapter: filesystem                        */
/* ---------------------------------------------------------------------- */

/**
 * File-per-workspace JSON store. One file per workspace under
 * `<rootDir>/<workspaceId>.versions/<version>.json`. Each version is written
 * completely and then hard-linked to its final path. Two processes racing the
 * same expected version therefore contend on one atomic filesystem operation.
 *
 * Why per-workspace versions and not one JSONL: subscriptions are accessed by
 * workspace id. Reads inspect only that workspace's immutable versions.
 *
 * The store does NOT use `fs.watch` — webhooks are the only writer in
 * production, and webhooks always go through `applyTransition()` →
 * `saveIfVersion()`, so the CAS catches the race.
 */
export class FileSystemSubscriptionStore implements SubscriptionStore {
  constructor(private readonly rootDir: string) {
    if (!rootDir.trim()) throw new Error('FileSystemSubscriptionStore requires a root directory')
  }

  async load(workspaceId: string): Promise<SubscriptionRecord | null> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const versionDir = await this.versionDir(workspaceId)
    let versionFiles: string[] = []
    try {
      versionFiles = (await fs.readdir(versionDir))
        .filter((file) => /^\d+\.json$/.test(file))
        .sort((left, right) => Number.parseInt(right, 10) - Number.parseInt(left, 10))
    } catch (err) {
      if (!isNodeENOENT(err)) throw err
    }

    const candidates: SubscriptionRecord[] = []
    if (versionFiles[0]) {
      candidates.push(await this.readRecord(path.join(versionDir, versionFiles[0]), workspaceId))
    }
    const legacyFile = path.join(this.rootDir, this.fileName(workspaceId))
    try {
      candidates.push(await this.readRecord(legacyFile, workspaceId))
    } catch (err) {
      if (!isNodeENOENT(err)) throw err
    }
    if (candidates.length === 0) return null
    candidates.sort((left, right) => right.version - left.version)
    if (
      candidates[1]
      && candidates[0]!.version === candidates[1].version
      && !sameSubscriptionRecord(candidates[0]!, candidates[1])
    ) {
      throw new Error(`Conflicting subscription version ${candidates[0]!.version} for ${workspaceId}`)
    }
    return { ...candidates[0]! }
  }

  async save(record: SubscriptionRecord): Promise<void> {
    assertSubscriptionRecord(record)
    const existing = await this.load(record.workspaceId)
    if (existing) {
      if (existing.version > record.version) {
        throw new Error(`Stale subscription save for ${record.workspaceId}`)
      }
      if (existing.version === record.version) {
        if (sameSubscriptionRecord(existing, record)) return
        throw new Error(`Conflicting subscription version ${record.version} for ${record.workspaceId}`)
      }
      if (record.version !== existing.version + 1) {
        throw new Error(`Subscription save must advance exactly one version for ${record.workspaceId}`)
      }
    } else if (record.version !== 0) {
      throw new Error(`Initial subscription version must be 0 for ${record.workspaceId}`)
    }
    if (!(await this.writeVersion(record))) {
      const winner = await this.load(record.workspaceId)
      if (winner && sameSubscriptionRecord(winner, record)) return
      throw new Error(`Subscription write contention for ${record.workspaceId}`)
    }
  }

  async saveIfVersion(record: SubscriptionRecord, expectedVersion: number): Promise<boolean> {
    assertSubscriptionRecord(record)
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return false
    const existing = await this.load(record.workspaceId)
    if (existing && existing.version !== expectedVersion) return false
    if (!existing && expectedVersion !== 0) return false
    if (existing && record.version !== expectedVersion + 1) return false
    if (!existing && record.version !== 0) return false
    return this.writeVersion(record)
  }

  private async readRecord(file: string, expectedWorkspaceId: string): Promise<SubscriptionRecord> {
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(file, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`Invalid subscription JSON at ${file}`)
    }
    const record = normalizeSubscriptionRecord(parsed)
    if (record.workspaceId !== expectedWorkspaceId) {
      throw new Error(`Subscription workspace mismatch at ${file}`)
    }
    return record
  }

  private async writeVersion(record: SubscriptionRecord): Promise<boolean> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const versionDir = await this.versionDir(record.workspaceId)
    await fs.mkdir(versionDir, { recursive: true, mode: 0o700 })
    const finalFile = path.join(versionDir, `${record.version}.json`)
    const tmp = path.join(versionDir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const handle = await fs.open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(record), 'utf8')
      await handle.sync()
      await handle.close()
      try {
        await fs.link(tmp, finalFile)
        await syncDirectory(versionDir)
        return true
      } catch (err) {
        if (isNodeEEXIST(err)) return false
        throw err
      }
    } catch (err) {
      throw err
    } finally {
      await handle.close().catch(() => undefined)
      await fs.unlink(tmp).catch(() => undefined)
    }
  }

  private async versionDir(workspaceId: string): Promise<string> {
    const path = await import('node:path')
    return path.join(this.rootDir, `${this.fileName(workspaceId)}.versions`)
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
  eventId?: string
  eventCreatedAt?: number
  pendingEventId?: string | null
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
    lastEventId: input.eventId ?? null,
    lastEventCreatedAt: input.eventCreatedAt ?? null,
    lastEventPreviousState: null,
    pendingEventId: input.pendingEventId ?? null,
    updatedAt: now,
  }
}

function normalizeSubscriptionRecord(value: unknown): SubscriptionRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid subscription record')
  const candidate = value as Partial<SubscriptionRecord>
  const record = {
    ...candidate,
    lastEventCreatedAt: candidate.lastEventCreatedAt ?? null,
    lastEventPreviousState: candidate.lastEventPreviousState ?? null,
    pendingEventId: candidate.pendingEventId ?? null,
  } as SubscriptionRecord
  assertSubscriptionRecord(record)
  return record
}

function assertSubscriptionRecord(record: SubscriptionRecord): void {
  if (!record || typeof record !== 'object') throw new Error('Invalid subscription record')
  if (!record.workspaceId?.trim()) throw new Error('Subscription workspaceId is required')
  if (!record.customerId?.trim()) throw new Error('Subscription customerId is required')
  if (!record.subscriptionId?.trim()) throw new Error('Subscription subscriptionId is required')
  if (!SUBSCRIPTION_STATES.includes(record.state)) throw new Error('Invalid subscription state')
  if (!Number.isSafeInteger(record.version) || record.version < 0) throw new Error('Invalid subscription version')
  if (record.lastEventId !== null && typeof record.lastEventId !== 'string') throw new Error('Invalid lastEventId')
  if (
    record.lastEventCreatedAt !== null
    && (!Number.isSafeInteger(record.lastEventCreatedAt) || record.lastEventCreatedAt < 0)
  ) throw new Error('Invalid lastEventCreatedAt')
  if (
    record.lastEventPreviousState !== undefined
    && record.lastEventPreviousState !== null
    && !SUBSCRIPTION_STATES.includes(record.lastEventPreviousState)
  ) throw new Error('Invalid lastEventPreviousState')
  if (
    record.pendingEventId !== undefined
    && record.pendingEventId !== null
    && (typeof record.pendingEventId !== 'string' || !record.pendingEventId.trim())
  ) throw new Error('Invalid pendingEventId')
  if (!Number.isFinite(record.updatedAt)) throw new Error('Invalid subscription updatedAt')
}

function sameSubscriptionRecord(left: SubscriptionRecord, right: SubscriptionRecord): boolean {
  return left.workspaceId === right.workspaceId
    && left.customerId === right.customerId
    && left.subscriptionId === right.subscriptionId
    && left.state === right.state
    && left.priceId === right.priceId
    && left.currentPeriodEnd === right.currentPeriodEnd
    && left.trialEnd === right.trialEnd
    && left.cancelAtPeriodEnd === right.cancelAtPeriodEnd
    && left.version === right.version
    && left.lastEventId === right.lastEventId
    && left.lastEventCreatedAt === right.lastEventCreatedAt
    && (left.lastEventPreviousState ?? null) === (right.lastEventPreviousState ?? null)
    && (left.pendingEventId ?? null) === (right.pendingEventId ?? null)
    && left.updatedAt === right.updatedAt
}

function isNodeEEXIST(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'EEXIST'
}

async function syncDirectory(directory: string): Promise<void> {
  const fs = await import('node:fs/promises')
  const handle = await fs.open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
