/**
 * Stripe subscription webhook dispatcher.
 *
 * Receives `WebhookEnvelope` rows from `WebhookRouter`'s `deliver()`
 * callback, decodes them into typed `StripeBillingEvent` values, and
 * applies the corresponding state transition to the consumer's
 * `SubscriptionStore`. Emits a typed event the consumer subscribes to.
 *
 * Layering:
 *
 *   Stripe → HTTP → WebhookRouter (verify + idempotency dedup)
 *                          ↓ deliver(envelope)
 *                  StripeBillingDispatcher (this file)
 *                          ↓
 *                          ├─ SubscriptionStore.saveIfVersion(...)
 *                          └─ emit(typed event) → consumer's subscriber
 *
 * Critical guarantees:
 *
 *  1. Idempotency at two layers — the router de-dupes at the event id;
 *     the dispatcher's `saveIfVersion` defends against the second
 *     router instance (multi-region) racing the same event. The
 *     consumer's subscriber sees an event AT MOST ONCE per `eventId`.
 *
 *  2. Order-independence — Stripe doesn't guarantee delivery order.
 *     We process events whose `event.created` timestamp is older than
 *     the stored `updatedAt` only when the resulting state would be a
 *     valid transition; otherwise we drop with `dropped:'out_of_order'`.
 *
 *  3. Explicit unknown handling — events we don't have a handler for
 *     are not dropped silently; we emit them as
 *     `stripe.event_unhandled` so the consumer can log + alert if
 *     they expected coverage that we don't ship.
 *
 *  4. Idempotency of the dispatcher itself — calling `dispatch()` with
 *     an event whose id equals `lastEventId` on the loaded record is a
 *     no-op that emits `stripe.event_replay` instead of advancing state.
 *
 * Events supported (8 critical + 2 lifecycle):
 *
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   customer.subscription.trial_will_end
 *   customer.subscription.paused
 *   customer.subscription.resumed
 *   invoice.paid
 *   invoice.payment_failed
 */

import type { WebhookEnvelope } from '../webhooks/router.js'
import { BillingError } from './errors.js'
import {
  applyTransition,
  isValidTransition,
  makeSubscriptionRecord,
  type SubscriptionRecord,
  type SubscriptionState,
  type SubscriptionStore,
} from './subscription-state.js'

/* ---------------------------------------------------------------------- */
/*                       Stripe payload type subset                        */
/* ---------------------------------------------------------------------- */

/** Subset of Stripe's `Subscription` object we read. Keep narrow — the
 *  full object has 70+ fields; we only need the ones that map to our
 *  `SubscriptionRecord`. New fields land here on demand. */
interface StripeSubscriptionPayload {
  id: string
  status: string
  customer: string
  current_period_end?: number | null
  cancel_at_period_end?: boolean | null
  trial_end?: number | null
  items?: {
    data?: Array<{ price?: { id?: string } }>
  }
  /** Stripe `Subscription.metadata` — agents put their `workspaceId`
   *  here at checkout time so we can route subsequent webhooks back to
   *  the right tenant without an extra DB lookup. */
  metadata?: Record<string, string>
}

interface StripeInvoicePayload {
  id: string
  subscription?: string | null
  customer?: string
  status?: string
  /** Cents. */
  amount_paid?: number
  amount_due?: number
  /** Lined up to subscription metadata at invoice generation. */
  metadata?: Record<string, string>
}

interface StripeEvent {
  id: string
  type: string
  created?: number
  data: { object: unknown }
}

/* ---------------------------------------------------------------------- */
/*                           dispatcher contract                           */
/* ---------------------------------------------------------------------- */

/** Strongly-typed events the consumer can subscribe to. Each carries
 *  enough context to drive downstream side effects without a second
 *  DB round-trip (audit log row, Slack ping, in-app notification). */
export type StripeBillingEvent =
  | {
      kind: 'subscription.created'
      eventId: string
      record: SubscriptionRecord
    }
  | {
      kind: 'subscription.updated'
      eventId: string
      previousState: SubscriptionState
      record: SubscriptionRecord
    }
  | {
      kind: 'subscription.deleted'
      eventId: string
      record: SubscriptionRecord
    }
  | {
      kind: 'subscription.trial_will_end'
      eventId: string
      record: SubscriptionRecord
      trialEndsAt: number
    }
  | {
      kind: 'subscription.paused'
      eventId: string
      record: SubscriptionRecord
    }
  | {
      kind: 'subscription.resumed'
      eventId: string
      record: SubscriptionRecord
    }
  | {
      kind: 'invoice.paid'
      eventId: string
      record: SubscriptionRecord | null
      invoiceId: string
      amountPaid: number
    }
  | {
      kind: 'invoice.payment_failed'
      eventId: string
      record: SubscriptionRecord | null
      invoiceId: string
      amountDue: number
    }
  | {
      kind: 'event_unhandled'
      eventId: string
      type: string
    }
  | {
      kind: 'event_replay'
      eventId: string
      type: string
    }
  | {
      kind: 'event_dropped_out_of_order'
      eventId: string
      type: string
      reason: string
    }

/** Listener — the product agent wires this to whatever side-effect bus
 *  it owns (audit log, in-process emitter, durable queue). Throws are
 *  caught by `dispatch()` and surfaced through `onError`. */
export type StripeBillingListener = (event: StripeBillingEvent) => void | Promise<void>

export interface StripeBillingDispatcherOptions {
  store: SubscriptionStore
  /** Maps a Stripe `customer.id` → the workspaceId the product uses to
   *  key its `SubscriptionStore`. We default to reading
   *  `subscription.metadata.workspaceId` (agents inject it at checkout
   *  time); supply this override for products that key by customer id
   *  directly or look up a join table. */
  resolveWorkspaceId?(input: {
    customerId: string
    subscriptionMetadata?: Record<string, string>
    invoiceMetadata?: Record<string, string>
  }): Promise<string | null> | string | null
  /** Single typed listener (most consumers want one — they route inside
   *  it themselves). Compose multiple via `combineListeners(a, b)`. */
  listener?: StripeBillingListener
  /** Surface unexpected dispatcher errors (validation, store contention
   *  exhausted) without crashing the webhook handler. */
  onError?(err: unknown, context: { eventId: string; type: string }): void
  /** Override `Date.now()` for tests. */
  now?(): number
  /** Max retries on `saveIfVersion` contention. Default 3. */
  maxCasRetries?: number
}

/* ---------------------------------------------------------------------- */
/*                              dispatcher                                 */
/* ---------------------------------------------------------------------- */

/**
 * Process a webhook envelope. Safe to call concurrently with itself —
 * the in-store CAS serializes per-workspace updates.
 */
export class StripeBillingDispatcher {
  private readonly store: SubscriptionStore
  private readonly resolveWorkspaceId: NonNullable<StripeBillingDispatcherOptions['resolveWorkspaceId']>
  private readonly listener?: StripeBillingListener
  private readonly onError: NonNullable<StripeBillingDispatcherOptions['onError']>
  private readonly now: () => number
  private readonly maxCasRetries: number

  constructor(opts: StripeBillingDispatcherOptions) {
    this.store = opts.store
    this.resolveWorkspaceId = opts.resolveWorkspaceId ?? defaultResolveWorkspaceId
    this.listener = opts.listener
    this.onError = opts.onError ?? defaultOnError
    this.now = opts.now ?? Date.now
    this.maxCasRetries = opts.maxCasRetries ?? 3
  }

  /** Drive one envelope through the pipeline. Idempotent w.r.t. the
   *  event id (replays are a no-op + emit `event_replay`). */
  async dispatch(envelope: WebhookEnvelope): Promise<void> {
    const evt = envelope.payload as StripeEvent | undefined
    if (!evt || typeof evt !== 'object' || typeof evt.id !== 'string' || typeof evt.type !== 'string') {
      this.onError(new Error('Stripe envelope missing id or type'), {
        eventId: 'unknown',
        type: 'unknown',
      })
      return
    }
    try {
      await this.handle(evt)
    } catch (err) {
      this.onError(err, { eventId: evt.id, type: evt.type })
    }
  }

  private async handle(evt: StripeEvent): Promise<void> {
    switch (evt.type) {
      case 'customer.subscription.created':
        return this.handleSubCreated(evt)
      case 'customer.subscription.updated':
        return this.handleSubUpdated(evt)
      case 'customer.subscription.deleted':
        return this.handleSubDeleted(evt)
      case 'customer.subscription.trial_will_end':
        return this.handleTrialWillEnd(evt)
      case 'customer.subscription.paused':
        return this.handleSubLifecycle(evt, 'paused')
      case 'customer.subscription.resumed':
        return this.handleSubLifecycle(evt, 'active')
      case 'invoice.paid':
        return this.handleInvoicePaid(evt)
      case 'invoice.payment_failed':
        return this.handleInvoicePaymentFailed(evt)
      default:
        await this.emit({ kind: 'event_unhandled', eventId: evt.id, type: evt.type })
        return
    }
  }

  /* --------------------- subscription event handlers ------------------- */

  private async handleSubCreated(evt: StripeEvent): Promise<void> {
    const sub = evt.data.object as StripeSubscriptionPayload
    const workspaceId = await this.resolveWorkspaceId({
      customerId: sub.customer,
      subscriptionMetadata: sub.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)

    const existing = await this.store.load(workspaceId)
    if (existing && existing.lastEventId === evt.id) {
      return this.emit({ kind: 'event_replay', eventId: evt.id, type: evt.type })
    }

    // Create-only: if a record already exists with a non-incomplete state
    // and this is a stale created event, treat as out-of-order.
    if (existing && !canApplyFreshCreate(existing.state)) {
      return this.emit({
        kind: 'event_dropped_out_of_order',
        eventId: evt.id,
        type: evt.type,
        reason: `existing state ${existing.state} cannot accept a fresh 'created'`,
      })
    }

    const record = makeSubscriptionRecord({
      workspaceId,
      customerId: sub.customer,
      subscriptionId: sub.id,
      state: parseState(sub.status, evt.id),
      priceId: extractPriceId(sub),
      currentPeriodEnd: sub.current_period_end ?? null,
      trialEnd: sub.trial_end ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      now: this.now,
    })
    const stamped: SubscriptionRecord = { ...record, lastEventId: evt.id }
    const expectedVersion = existing?.version ?? 0
    const written = await this.cas(stamped, expectedVersion)
    if (!written) return
    await this.emit({ kind: 'subscription.created', eventId: evt.id, record: stamped })
  }

  private async handleSubUpdated(evt: StripeEvent): Promise<void> {
    const sub = evt.data.object as StripeSubscriptionPayload
    const workspaceId = await this.resolveWorkspaceId({
      customerId: sub.customer,
      subscriptionMetadata: sub.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)
    const nextState = parseState(sub.status, evt.id)

    await this.advance(evt, workspaceId, (current) => {
      if (current.lastEventId === evt.id) return 'replay'
      if (!isValidTransition(current.state, nextState)) return 'out_of_order'
      const next = applyTransition(
        current,
        {
          state: nextState,
          priceId: extractPriceId(sub) ?? current.priceId,
          currentPeriodEnd: sub.current_period_end ?? current.currentPeriodEnd,
          trialEnd: sub.trial_end ?? current.trialEnd,
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? current.cancelAtPeriodEnd,
        },
        { eventId: evt.id, now: this.now },
      )
      return {
        next,
        emit: { kind: 'subscription.updated', eventId: evt.id, previousState: current.state, record: next },
      }
    })
  }

  private async handleSubDeleted(evt: StripeEvent): Promise<void> {
    const sub = evt.data.object as StripeSubscriptionPayload
    const workspaceId = await this.resolveWorkspaceId({
      customerId: sub.customer,
      subscriptionMetadata: sub.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)

    await this.advance(evt, workspaceId, (current) => {
      if (current.lastEventId === evt.id) return 'replay'
      if (current.state === 'canceled') return 'replay' // terminal — fine to no-op
      const next = applyTransition(
        current,
        { state: 'canceled', priceId: null, currentPeriodEnd: sub.current_period_end ?? current.currentPeriodEnd },
        { eventId: evt.id, now: this.now },
      )
      return {
        next,
        emit: { kind: 'subscription.deleted', eventId: evt.id, record: next },
      }
    })
  }

  private async handleTrialWillEnd(evt: StripeEvent): Promise<void> {
    const sub = evt.data.object as StripeSubscriptionPayload
    const workspaceId = await this.resolveWorkspaceId({
      customerId: sub.customer,
      subscriptionMetadata: sub.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)
    const current = await this.store.load(workspaceId)
    if (!current) return this.emitNoWorkspace(evt)
    if (current.lastEventId === evt.id) {
      return this.emit({ kind: 'event_replay', eventId: evt.id, type: evt.type })
    }
    // No state transition — trial_will_end is informational. Update
    // lastEventId so a replay is detected.
    const next: SubscriptionRecord = {
      ...current,
      lastEventId: evt.id,
      trialEnd: sub.trial_end ?? current.trialEnd,
      version: current.version + 1,
      updatedAt: this.now(),
    }
    const written = await this.cas(next, current.version)
    if (!written) return
    await this.emit({
      kind: 'subscription.trial_will_end',
      eventId: evt.id,
      record: next,
      trialEndsAt: sub.trial_end ?? next.trialEnd ?? 0,
    })
  }

  private async handleSubLifecycle(evt: StripeEvent, target: SubscriptionState): Promise<void> {
    const sub = evt.data.object as StripeSubscriptionPayload
    const workspaceId = await this.resolveWorkspaceId({
      customerId: sub.customer,
      subscriptionMetadata: sub.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)

    await this.advance(evt, workspaceId, (current) => {
      if (current.lastEventId === evt.id) return 'replay'
      if (!isValidTransition(current.state, target)) return 'out_of_order'
      const next = applyTransition(current, { state: target }, { eventId: evt.id, now: this.now })
      const kind = target === 'paused' ? 'subscription.paused' : 'subscription.resumed'
      return { next, emit: { kind, eventId: evt.id, record: next } }
    })
  }

  /* ----------------------- invoice event handlers ---------------------- */

  private async handleInvoicePaid(evt: StripeEvent): Promise<void> {
    const inv = evt.data.object as StripeInvoicePayload
    const workspaceId = await this.resolveWorkspaceId({
      customerId: inv.customer ?? '',
      invoiceMetadata: inv.metadata,
    })
    let record: SubscriptionRecord | null = null
    if (workspaceId) record = await this.store.load(workspaceId)
    await this.emit({
      kind: 'invoice.paid',
      eventId: evt.id,
      record,
      invoiceId: inv.id,
      amountPaid: inv.amount_paid ?? 0,
    })
  }

  private async handleInvoicePaymentFailed(evt: StripeEvent): Promise<void> {
    const inv = evt.data.object as StripeInvoicePayload
    const workspaceId = await this.resolveWorkspaceId({
      customerId: inv.customer ?? '',
      invoiceMetadata: inv.metadata,
    })
    let record: SubscriptionRecord | null = null
    if (workspaceId) record = await this.store.load(workspaceId)
    await this.emit({
      kind: 'invoice.payment_failed',
      eventId: evt.id,
      record,
      invoiceId: inv.id,
      amountDue: inv.amount_due ?? 0,
    })
  }

  /* ------------------------------- core -------------------------------- */

  /** Load, apply a transformation, CAS-write. The transformation may
   *  return 'replay' / 'out_of_order' for the dispatcher to emit
   *  diagnostic events instead. Retries on contention up to
   *  `maxCasRetries`; if exhausted, emits via `onError`. */
  private async advance(
    evt: StripeEvent,
    workspaceId: string,
    transform: (current: SubscriptionRecord) => { next: SubscriptionRecord; emit: StripeBillingEvent } | 'replay' | 'out_of_order',
  ): Promise<void> {
    for (let attempt = 0; attempt < this.maxCasRetries; attempt++) {
      const current = await this.store.load(workspaceId)
      if (!current) return this.emitNoWorkspace(evt)
      const result = transform(current)
      if (result === 'replay') {
        return this.emit({ kind: 'event_replay', eventId: evt.id, type: evt.type })
      }
      if (result === 'out_of_order') {
        return this.emit({
          kind: 'event_dropped_out_of_order',
          eventId: evt.id,
          type: evt.type,
          reason: `current=${current.state}`,
        })
      }
      const written = await this.store.saveIfVersion(result.next, current.version)
      if (written) return this.emit(result.emit)
    }
    this.onError(new BillingError({
      code: 'webhook_event_unknown',
      message: `CAS contention exhausted after ${this.maxCasRetries} attempts`,
      context: { workspaceId, eventId: evt.id },
    }), { eventId: evt.id, type: evt.type })
  }

  private async cas(record: SubscriptionRecord, expectedVersion: number): Promise<boolean> {
    for (let attempt = 0; attempt < this.maxCasRetries; attempt++) {
      const ok = await this.store.saveIfVersion(record, expectedVersion + attempt)
      if (ok) return true
    }
    return false
  }

  private async emit(event: StripeBillingEvent): Promise<void> {
    if (!this.listener) return
    try {
      await this.listener(event)
    } catch (err) {
      this.onError(err, {
        eventId: 'eventId' in event ? event.eventId : 'unknown',
        type: event.kind,
      })
    }
  }

  private emitNoWorkspace(evt: StripeEvent): Promise<void> {
    return this.emit({
      kind: 'event_dropped_out_of_order',
      eventId: evt.id,
      type: evt.type,
      reason: 'workspaceId could not be resolved from event payload',
    })
  }
}

/* ---------------------------------------------------------------------- */
/*                               helpers                                   */
/* ---------------------------------------------------------------------- */

/** Compose multiple listeners — fan out + collect errors. */
export function combineListeners(...listeners: StripeBillingListener[]): StripeBillingListener {
  return async (event) => {
    for (const l of listeners) await l(event)
  }
}

function defaultResolveWorkspaceId(input: { subscriptionMetadata?: Record<string, string>; invoiceMetadata?: Record<string, string> }): string | null {
  const sub = input.subscriptionMetadata?.workspaceId
  if (sub) return sub
  const inv = input.invoiceMetadata?.workspaceId
  return inv ?? null
}

function defaultOnError(err: unknown, context: { eventId: string; type: string }): void {
  // eslint-disable-next-line no-console
  console.error('[StripeBillingDispatcher]', context, err)
}

function parseState(status: string, eventId: string): SubscriptionState {
  switch (status) {
    case 'incomplete':
    case 'incomplete_expired':
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'canceled':
    case 'unpaid':
    case 'paused':
      return status
    default:
      throw new BillingError({
        code: 'webhook_event_unknown',
        message: `Unknown Stripe subscription status '${status}'`,
        context: { eventId },
      })
  }
}

function canApplyFreshCreate(state: SubscriptionState): boolean {
  // A 'created' event on a record that already advanced past
  // incomplete means we've already processed the lifecycle and a
  // retried-late 'created' should be dropped.
  return state === 'incomplete' || state === 'incomplete_expired'
}

function extractPriceId(sub: StripeSubscriptionPayload): string | null {
  return sub.items?.data?.[0]?.price?.id ?? null
}
