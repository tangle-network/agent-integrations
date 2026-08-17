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
 *     a finished claim is distinguishable from concurrent work. Listener
 *     failure releases the claim and reaches the HTTP layer as a failure.
 *
 *  2. Order-independence — Stripe doesn't guarantee delivery order.
 *     We persist the newest applied `event.created` timestamp and reject
 *     older subscription events. Stripe timestamps have one-second resolution,
 *     so equal timestamps require an authenticated current-state read.
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
import {
  FileSystemAtomicIdempotencyStore,
  InMemoryAtomicIdempotencyStore,
  resolveAtomicIdempotencyStore,
  type AtomicIdempotencyStore,
  type IdempotencyRuntime,
} from '../idempotency.js'
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
export interface StripeSubscriptionSnapshot {
  id: string
  status: string
  customer: string | { id?: string }
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
  /** Legacy Stripe versions expose the subscription at the top level. */
  subscription?: string | null
  /** Stripe 2025-03-31.basil and newer move subscription identity here. */
  parent?: {
    type?: string
    subscription_details?: {
      subscription?: string | { id?: string } | null
      metadata?: Record<string, string>
    } | null
  } | null
  customer?: string
  status?: string
  /** Cents. */
  amount_paid?: number
  amount_due?: number
  /** Lined up to subscription metadata at invoice generation. */
  metadata?: Record<string, string>
}

interface StripeSubscriptionIdentity {
  customerId: string
  subscriptionId: string
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
      kind: 'subscription.trial_ignored'
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
      kind: 'invoice.zero_dollar_ignored'
      eventId: string
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

/** Listener — production consumers must durably enqueue by `eventId` before
 *  resolving. A throw releases the claim and reaches the HTTP boundary. */
export type StripeBillingListener = (event: StripeBillingEvent) => void | Promise<void>

export interface StripeEventIdempotencyStore extends AtomicIdempotencyStore {}

/** Process-local store for direct dispatcher use and tests. */
export class InMemoryStripeEventIdempotencyStore extends InMemoryAtomicIdempotencyStore implements StripeEventIdempotencyStore {}

/** Durable store for workers that share the same filesystem directory. */
export class FileSystemStripeEventIdempotencyStore extends FileSystemAtomicIdempotencyStore implements StripeEventIdempotencyStore {}

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
  /** Retrieve the current subscription through an authenticated Stripe API
   *  client. Equal `event.created` timestamps fail until this callback returns
   *  an authoritative snapshot. */
  retrieveSubscription?(subscriptionId: string): Promise<StripeSubscriptionSnapshot>
  /** Single typed listener (most consumers want one — they route inside
   *  it themselves). Compose multiple via `combineListeners(a, b)`. */
  listener?: StripeBillingListener
  /** Observe unexpected dispatcher errors before they are rethrown. */
  onError?(err: unknown, context: { eventId: string; type: string }): void
  /** Override `Date.now()` for tests. */
  now?(): number
  /** Max retries on `saveIfVersion` contention. Default 3. */
  maxCasRetries?: number
  /** Separate atomic event store for direct dispatcher calls. */
  idempotency?: StripeEventIdempotencyStore
  /** Runtime controls the safe default. Production fails closed without a
   *  shared store; test/development use an in-memory store when omitted. */
  runtime?: IdempotencyRuntime
  idempotencyTtlMs?: number
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
  private readonly retrieveSubscription?: StripeBillingDispatcherOptions['retrieveSubscription']
  private readonly listener?: StripeBillingListener
  private readonly onError: NonNullable<StripeBillingDispatcherOptions['onError']>
  private readonly now: () => number
  private readonly maxCasRetries: number
  private readonly idempotency: StripeEventIdempotencyStore
  private readonly idempotencyTtlMs: number

  constructor(opts: StripeBillingDispatcherOptions) {
    this.store = opts.store
    this.resolveWorkspaceId = opts.resolveWorkspaceId ?? defaultResolveWorkspaceId
    this.retrieveSubscription = opts.retrieveSubscription
    this.listener = opts.listener
    this.onError = opts.onError ?? defaultOnError
    this.now = opts.now ?? Date.now
    this.maxCasRetries = opts.maxCasRetries ?? 3
    this.idempotency = resolveAtomicIdempotencyStore({
      component: 'StripeBillingDispatcher',
      store: opts.idempotency,
      runtime: opts.runtime,
    })
    if (isProductionRuntime(opts.runtime) && !opts.listener) {
      throw new Error('StripeBillingDispatcher: production requires a durable billing listener')
    }
    this.idempotencyTtlMs = opts.idempotencyTtlMs ?? 7 * 24 * 60 * 60 * 1000
  }

  /** Drive one envelope through the pipeline. Idempotent w.r.t. the
   *  event id (replays are a no-op + emit `event_replay`). */
  async dispatch(envelope: WebhookEnvelope): Promise<void> {
    const evt = envelope.payload as StripeEvent | undefined
    if (!evt || typeof evt !== 'object' || typeof evt.id !== 'string' || typeof evt.type !== 'string') {
      const error = new Error('Stripe envelope missing id or type')
      this.onError(error, {
        eventId: 'unknown',
        type: 'unknown',
      })
      throw error
    }
    const claimStatus = await this.idempotency.claimStatus(evt.id, this.idempotencyTtlMs)
    if (claimStatus === 'completed') {
      await this.emit({ kind: 'event_replay', eventId: evt.id, type: evt.type })
      return
    }
    if (claimStatus === 'in_progress') {
      const error = new BillingError({
        code: 'webhook_event_unknown',
        message: `Stripe event ${evt.id} is already in progress`,
        context: { eventId: evt.id },
      })
      throw error
    }
    try {
      await this.handle(evt)
      await this.idempotency.complete(evt.id)
    } catch (err) {
      try {
        await this.idempotency.release(evt.id)
      } catch (releaseError) {
        this.onError(releaseError, { eventId: evt.id, type: evt.type })
      }
      this.onError(err, { eventId: evt.id, type: evt.type })
      throw err
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
    const eventCreatedAt = requireEventCreatedAt(evt)
    const sub = evt.data.object as StripeSubscriptionSnapshot
    const identity = subscriptionIdentity(sub)
    if (!identity) return this.emitUnbound(evt, 'subscription event is missing customer or subscription id')
    const workspaceId = await this.resolveWorkspaceId({
      customerId: identity.customerId,
      subscriptionMetadata: sub.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)

    const existing = await this.store.load(workspaceId)
    // A `created` event names a subscription the record does not hold. That is
    // a foreign event unless the same customer is starting a new subscription
    // after the recorded one reached a terminal state — the resubscribe path.
    // Rebinding only from a terminal state keeps a live subscription bound.
    const rebinds =
      existing !== null &&
      !matchesSubscription(existing, identity) &&
      existing.customerId === identity.customerId &&
      isTerminalSubscriptionState(existing.state)
    if (existing && !matchesSubscription(existing, identity) && !rebinds) {
      return this.emitUnbound(evt, 'subscription identity does not match the workspace record')
    }
    this.assertNoPendingSubscriptionEvent(existing, evt)
    if (existing && existing.lastEventId === evt.id) {
      return this.emitPersisted(
        existing.state === 'trialing'
          ? { kind: 'subscription.trial_ignored', eventId: evt.id, record: existing }
          : { kind: 'subscription.created', eventId: evt.id, record: existing },
        workspaceId,
      )
    }
    if (existing && isOlderEvent(existing, eventCreatedAt)) {
      return this.emitOlderEvent(evt, existing)
    }
    if (existing && isEqualTimestampEvent(existing, eventCreatedAt)) {
      return this.reconcileEqualTimestamp(evt, workspaceId, identity)
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

    const nextState = parseState(sub.status, evt.id)
    const freshRecord = makeSubscriptionRecord({
      workspaceId,
      customerId: identity.customerId,
      subscriptionId: identity.subscriptionId,
      state: nextState,
      priceId: extractPriceId(sub),
      currentPeriodEnd: sub.current_period_end ?? null,
      trialEnd: sub.trial_end ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      eventId: evt.id,
      eventCreatedAt,
      pendingEventId: evt.id,
      now: this.now,
    })
    // A rebind writes a fresh record rather than a transition: `applyTransition`
    // spreads the base, which would carry the terminal subscription's id into
    // the new one. The version still advances, so a concurrent writer's
    // compare-and-set fails as it does on every other path.
    const record = !existing
      ? freshRecord
      : rebinds
      ? { ...freshRecord, version: existing.version + 1 }
      : applyTransition(
          existing,
          {
            state: nextState,
            priceId: extractPriceId(sub),
            currentPeriodEnd: sub.current_period_end ?? null,
            trialEnd: sub.trial_end ?? null,
            cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
          },
          { eventId: evt.id, eventCreatedAt, pendingEventId: evt.id, now: this.now },
        )
    const expectedVersion = existing?.version ?? 0
    const written = await this.cas(record, expectedVersion)
    if (!written) return this.emitUnbound(evt, 'subscription create lost a concurrent compare-and-set')
    await this.emitPersisted(
      record.state === 'trialing'
        ? { kind: 'subscription.trial_ignored', eventId: evt.id, record }
        : { kind: 'subscription.created', eventId: evt.id, record },
      workspaceId,
    )
  }

  private async handleSubUpdated(evt: StripeEvent): Promise<void> {
    const eventCreatedAt = requireEventCreatedAt(evt)
    const sub = evt.data.object as StripeSubscriptionSnapshot
    const identity = subscriptionIdentity(sub)
    if (!identity) return this.emitUnbound(evt, 'subscription event is missing customer or subscription id')
    const workspaceId = await this.resolveWorkspaceId({
      customerId: identity.customerId,
      subscriptionMetadata: sub.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)
    const nextState = parseState(sub.status, evt.id)

    await this.advance(evt, workspaceId, (current) => {
      if (current.lastEventId === evt.id) {
        return {
          emitOnly: nextState === 'trialing'
            ? { kind: 'subscription.trial_ignored', eventId: evt.id, record: current }
            : {
                kind: 'subscription.updated',
                eventId: evt.id,
                previousState: current.lastEventPreviousState ?? current.state,
                record: current,
              },
        }
      }
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
        { eventId: evt.id, eventCreatedAt, pendingEventId: evt.id, now: this.now },
      )
      return {
        next,
        emit:
          nextState === 'trialing'
            ? { kind: 'subscription.trial_ignored', eventId: evt.id, record: next }
            : { kind: 'subscription.updated', eventId: evt.id, previousState: current.state, record: next },
      }
    }, identity)
  }

  private async handleSubDeleted(evt: StripeEvent): Promise<void> {
    const eventCreatedAt = requireEventCreatedAt(evt)
    const sub = evt.data.object as StripeSubscriptionSnapshot
    const identity = subscriptionIdentity(sub)
    if (!identity) return this.emitUnbound(evt, 'subscription event is missing customer or subscription id')
    const workspaceId = await this.resolveWorkspaceId({
      customerId: identity.customerId,
      subscriptionMetadata: sub.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)

    await this.advance(evt, workspaceId, (current) => {
      if (current.lastEventId === evt.id) {
        return { emitOnly: { kind: 'subscription.deleted', eventId: evt.id, record: current } }
      }
      if (current.state === 'canceled') return 'replay' // terminal — fine to no-op
      const next = applyTransition(
        current,
        { state: 'canceled', priceId: null, currentPeriodEnd: sub.current_period_end ?? current.currentPeriodEnd },
        { eventId: evt.id, eventCreatedAt, pendingEventId: evt.id, now: this.now },
      )
      return {
        next,
        emit: { kind: 'subscription.deleted', eventId: evt.id, record: next },
      }
    }, identity)
  }

  private async handleTrialWillEnd(evt: StripeEvent): Promise<void> {
    const eventCreatedAt = requireEventCreatedAt(evt)
    const sub = evt.data.object as StripeSubscriptionSnapshot
    const identity = subscriptionIdentity(sub)
    if (!identity) return this.emitUnbound(evt, 'subscription event is missing customer or subscription id')
    const workspaceId = await this.resolveWorkspaceId({
      customerId: identity.customerId,
      subscriptionMetadata: sub.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)
    const current = await this.store.load(workspaceId)
    if (!current) throw retryableStripeEvent(evt, 'subscription state is not available yet')
    if (!matchesSubscription(current, identity)) {
      return this.emitUnbound(evt, 'subscription identity does not match the workspace record')
    }
    this.assertNoPendingSubscriptionEvent(current, evt)
    if (current.lastEventId === evt.id) {
      return this.emitPersisted({
        kind: 'subscription.trial_will_end',
        eventId: evt.id,
        record: current,
        trialEndsAt: current.trialEnd ?? 0,
      }, workspaceId)
    }
    if (isOlderEvent(current, eventCreatedAt)) return this.emitOlderEvent(evt, current)
    if (isEqualTimestampEvent(current, eventCreatedAt)) {
      return this.reconcileEqualTimestamp(evt, workspaceId, identity)
    }
    // No state transition — trial_will_end is informational. Update
    // lastEventId so a replay is detected.
    const next: SubscriptionRecord = {
      ...current,
      lastEventId: evt.id,
      lastEventCreatedAt: eventCreatedAt,
      lastEventPreviousState: current.state,
      pendingEventId: evt.id,
      trialEnd: sub.trial_end ?? current.trialEnd,
      version: current.version + 1,
      updatedAt: this.now(),
    }
    const written = await this.cas(next, current.version)
    if (!written) return this.emitUnbound(evt, 'trial update lost a concurrent compare-and-set')
    await this.emitPersisted({
      kind: 'subscription.trial_will_end',
      eventId: evt.id,
      record: next,
      trialEndsAt: sub.trial_end ?? next.trialEnd ?? 0,
    }, workspaceId)
  }

  private async handleSubLifecycle(evt: StripeEvent, target: SubscriptionState): Promise<void> {
    const eventCreatedAt = requireEventCreatedAt(evt)
    const sub = evt.data.object as StripeSubscriptionSnapshot
    const identity = subscriptionIdentity(sub)
    if (!identity) return this.emitUnbound(evt, 'subscription event is missing customer or subscription id')
    const workspaceId = await this.resolveWorkspaceId({
      customerId: identity.customerId,
      subscriptionMetadata: sub.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)

    await this.advance(evt, workspaceId, (current) => {
      if (current.lastEventId === evt.id) {
        const kind = target === 'paused' ? 'subscription.paused' : 'subscription.resumed'
        return { emitOnly: { kind, eventId: evt.id, record: current } }
      }
      if (!isValidTransition(current.state, target)) return 'out_of_order'
      const next = applyTransition(
        current,
        { state: target },
        { eventId: evt.id, eventCreatedAt, pendingEventId: evt.id, now: this.now },
      )
      const kind = target === 'paused' ? 'subscription.paused' : 'subscription.resumed'
      return { next, emit: { kind, eventId: evt.id, record: next } }
    }, identity)
  }

  /* ----------------------- invoice event handlers ---------------------- */

  private async handleInvoicePaid(evt: StripeEvent): Promise<void> {
    const inv = evt.data.object as StripeInvoicePayload
    if (!invoiceIdentity(inv)) return this.emitUnbound(evt, 'paid invoice is missing customer or invoice id')
    const subscription = invoiceSubscription(inv)
    if (!subscription) return this.emitUnbound(evt, 'paid invoice is missing a subscription id')
    const workspaceId = await this.resolveWorkspaceId({
      customerId: inv.customer ?? '',
      invoiceMetadata: subscription.metadata ?? inv.metadata,
    })
    const amountPaid = typeof inv.amount_paid === 'number' && Number.isFinite(inv.amount_paid) ? inv.amount_paid : 0
    if (amountPaid <= 0) {
      await this.emit({
        kind: 'invoice.zero_dollar_ignored',
        eventId: evt.id,
        invoiceId: inv.id,
        amountPaid,
      })
      return
    }
    if (!workspaceId) return this.emitNoWorkspace(evt)
    const record = await this.store.load(workspaceId)
    if (!record) throw retryableStripeEvent(evt, 'paid invoice subscription state is not available yet')
    if (record.customerId !== inv.customer || record.subscriptionId !== subscription.subscriptionId) {
      return this.emitUnbound(evt, 'paid invoice identity does not match the workspace record')
    }
    await this.emit({
      kind: 'invoice.paid',
      eventId: evt.id,
      record,
      invoiceId: inv.id,
      amountPaid,
    })
  }

  private async handleInvoicePaymentFailed(evt: StripeEvent): Promise<void> {
    const inv = evt.data.object as StripeInvoicePayload
    if (!invoiceIdentity(inv)) return this.emitUnbound(evt, 'failed invoice is missing customer or invoice id')
    const subscription = invoiceSubscription(inv)
    if (!subscription) return this.emitUnbound(evt, 'failed invoice is missing a subscription id')
    const workspaceId = await this.resolveWorkspaceId({
      customerId: inv.customer ?? '',
      invoiceMetadata: subscription.metadata ?? inv.metadata,
    })
    if (!workspaceId) return this.emitNoWorkspace(evt)
    const record = await this.store.load(workspaceId)
    if (!record) throw retryableStripeEvent(evt, 'failed invoice subscription state is not available yet')
    if (record.customerId !== inv.customer || record.subscriptionId !== subscription.subscriptionId) {
      return this.emitUnbound(evt, 'failed invoice identity does not match the workspace record')
    }
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
   *  `maxCasRetries`; if exhausted, throws so the event claim is released
   *  and the provider can retry. */
  private async advance(
    evt: StripeEvent,
    workspaceId: string,
    transform: (current: SubscriptionRecord) =>
      | { next: SubscriptionRecord; emit: StripeBillingEvent }
      | { emitOnly: StripeBillingEvent }
      | 'replay'
      | 'out_of_order',
    identity: StripeSubscriptionIdentity,
  ): Promise<void> {
    for (let attempt = 0; attempt < this.maxCasRetries; attempt++) {
      const current = await this.store.load(workspaceId)
      if (!current) throw retryableStripeEvent(evt, 'subscription state is not available yet')
      if (identity && !matchesSubscription(current, identity)) {
        return this.emitUnbound(evt, 'subscription identity does not match the workspace record')
      }
      this.assertNoPendingSubscriptionEvent(current, evt)
      const eventCreatedAt = requireEventCreatedAt(evt)
      if (current.lastEventId !== evt.id && isOlderEvent(current, eventCreatedAt)) {
        return this.emitOlderEvent(evt, current)
      }
      if (current.lastEventId !== evt.id && isEqualTimestampEvent(current, eventCreatedAt)) {
        return this.reconcileEqualTimestamp(evt, workspaceId, identity)
      }
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
      if ('emitOnly' in result) return this.emitPersisted(result.emitOnly, workspaceId)
      const written = await this.store.saveIfVersion(result.next, current.version)
      if (written) return this.emitPersisted(result.emit, workspaceId)
    }
    throw new BillingError({
      code: 'webhook_event_unknown',
      message: `CAS contention exhausted after ${this.maxCasRetries} attempts`,
      context: { workspaceId, eventId: evt.id },
    })
  }

  private async cas(record: SubscriptionRecord, expectedVersion: number): Promise<boolean> {
    // The record was built from one loaded version. Retrying it against a
    // newer expected version would overwrite another event with stale state.
    return this.store.saveIfVersion(record, expectedVersion)
  }

  private async emit(event: StripeBillingEvent): Promise<void> {
    if (!this.listener) return
    await this.listener(event)
  }

  private async emitPersisted(event: StripeBillingEvent, workspaceId: string): Promise<void> {
    await this.emit(event)
    await this.clearPendingSubscriptionEvent(workspaceId, event.eventId)
  }

  private assertNoPendingSubscriptionEvent(
    record: SubscriptionRecord | null,
    evt: StripeEvent,
  ): void {
    if (!record?.pendingEventId || record.pendingEventId === evt.id) return
    throw new BillingError({
      code: 'webhook_event_unknown',
      message: `Subscription event ${record.pendingEventId} still needs durable delivery`,
      context: { workspaceId: record.workspaceId, eventId: evt.id },
    })
  }

  private async clearPendingSubscriptionEvent(workspaceId: string, eventId: string): Promise<void> {
    for (let attempt = 0; attempt < this.maxCasRetries; attempt++) {
      const current = await this.store.load(workspaceId)
      if (!current) throw new Error(`Subscription record ${workspaceId} disappeared after delivery`)
      if (current.pendingEventId === null || current.pendingEventId === undefined) return
      if (current.pendingEventId !== eventId) {
        throw new Error(`Subscription pending event changed from ${eventId} to ${current.pendingEventId}`)
      }
      const cleared: SubscriptionRecord = {
        ...current,
        pendingEventId: null,
        version: current.version + 1,
        updatedAt: this.now(),
      }
      if (await this.store.saveIfVersion(cleared, current.version)) return
    }
    throw new BillingError({
      code: 'webhook_event_unknown',
      message: `Pending event clear exhausted after ${this.maxCasRetries} attempts`,
      context: { workspaceId, eventId },
    })
  }

  private async reconcileEqualTimestamp(
    evt: StripeEvent,
    workspaceId: string,
    expectedIdentity: StripeSubscriptionIdentity,
  ): Promise<void> {
    if (!this.retrieveSubscription) {
      throw retryableStripeEvent(evt, 'equal event.created timestamps require Stripe reconciliation')
    }
    const snapshot = await this.retrieveSubscription(expectedIdentity.subscriptionId)
    const canonicalIdentity = subscriptionIdentity(snapshot)
    if (
      !canonicalIdentity
      || canonicalIdentity.customerId !== expectedIdentity.customerId
      || canonicalIdentity.subscriptionId !== expectedIdentity.subscriptionId
    ) {
      throw retryableStripeEvent(evt, 'Stripe reconciliation returned a mismatched subscription')
    }
    const canonicalState = parseState(snapshot.status, evt.id)
    const eventCreatedAt = requireEventCreatedAt(evt)

    for (let attempt = 0; attempt < this.maxCasRetries; attempt++) {
      const current = await this.store.load(workspaceId)
      if (!current) throw retryableStripeEvent(evt, 'subscription state is not available yet')
      if (!matchesSubscription(current, expectedIdentity)) {
        return this.emitUnbound(evt, 'subscription identity does not match the workspace record')
      }
      this.assertNoPendingSubscriptionEvent(current, evt)
      if (current.lastEventId === evt.id) {
        return this.emitPersisted(canonicalBillingEvent(evt, current, current), workspaceId)
      }
      if (isOlderEvent(current, eventCreatedAt)) return this.emitOlderEvent(evt, current)
      if (!isEqualTimestampEvent(current, eventCreatedAt)) {
        throw retryableStripeEvent(evt, 'subscription state changed during Stripe reconciliation')
      }
      const next: SubscriptionRecord = {
        ...current,
        state: canonicalState,
        priceId: canonicalState === 'canceled' ? null : extractPriceId(snapshot),
        currentPeriodEnd: snapshot.current_period_end ?? null,
        trialEnd: snapshot.trial_end ?? null,
        cancelAtPeriodEnd: snapshot.cancel_at_period_end ?? false,
        version: current.version + 1,
        lastEventId: evt.id,
        lastEventCreatedAt: eventCreatedAt,
        lastEventPreviousState: current.state,
        pendingEventId: evt.id,
        updatedAt: this.now(),
      }
      if (await this.store.saveIfVersion(next, current.version)) {
        return this.emitPersisted(canonicalBillingEvent(evt, current, next), workspaceId)
      }
    }
    throw new BillingError({
      code: 'webhook_event_unknown',
      message: `Stripe reconciliation contention exhausted after ${this.maxCasRetries} attempts`,
      context: { workspaceId, eventId: evt.id },
    })
  }

  private emitNoWorkspace(evt: StripeEvent): Promise<void> {
    return this.emit({
      kind: 'event_dropped_out_of_order',
      eventId: evt.id,
      type: evt.type,
      reason: 'workspaceId could not be resolved from event payload',
    })
  }

  private emitUnbound(evt: StripeEvent, reason: string): Promise<void> {
    return this.emit({
      kind: 'event_dropped_out_of_order',
      eventId: evt.id,
      type: evt.type,
      reason,
    })
  }

  private emitOlderEvent(evt: StripeEvent, current: SubscriptionRecord): Promise<void> {
    return this.emit({
      kind: 'event_dropped_out_of_order',
      eventId: evt.id,
      type: evt.type,
      reason: `event.created=${evt.created} is older than stored=${current.lastEventCreatedAt}`,
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

function subscriptionIdentity(value: unknown): StripeSubscriptionIdentity | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { customer?: unknown; id?: unknown }
  const customerId = readExpandableId(candidate.customer)
  if (!customerId) return null
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null
  return { customerId, subscriptionId: candidate.id }
}

function invoiceIdentity(value: unknown): { customer: string; id: string } | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { customer?: unknown; id?: unknown }
  if (typeof candidate.customer !== 'string' || !candidate.customer.trim()) return null
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null
  return { customer: candidate.customer, id: candidate.id }
}

function invoiceSubscription(
  invoice: StripeInvoicePayload,
): { subscriptionId: string; metadata?: Record<string, string> } | null {
  if (invoice.parent !== undefined && invoice.parent !== null) {
    if (invoice.parent.type !== 'subscription_details') return null
    const details = invoice.parent.subscription_details
    const subscriptionId = readExpandableId(details?.subscription)
    if (!subscriptionId) return null
    return {
      subscriptionId,
      ...(details?.metadata ? { metadata: details.metadata } : {}),
    }
  }
  const subscriptionId = readExpandableId(invoice.subscription)
  return subscriptionId ? { subscriptionId } : null
}

function readExpandableId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.trim() ? id : null
}

function matchesSubscription(record: SubscriptionRecord, identity: StripeSubscriptionIdentity): boolean {
  return record.customerId === identity.customerId && record.subscriptionId === identity.subscriptionId
}

function requireEventCreatedAt(evt: StripeEvent): number {
  if (!Number.isSafeInteger(evt.created) || (evt.created as number) < 0) {
    throw new BillingError({
      code: 'webhook_event_unknown',
      message: 'Stripe subscription event is missing a valid event.created timestamp',
      context: { eventId: evt.id },
    })
  }
  return evt.created as number
}

function isOlderEvent(record: SubscriptionRecord, eventCreatedAt: number): boolean {
  return record.lastEventCreatedAt !== null && eventCreatedAt < record.lastEventCreatedAt
}

function isEqualTimestampEvent(record: SubscriptionRecord, eventCreatedAt: number): boolean {
  return record.lastEventCreatedAt !== null && eventCreatedAt === record.lastEventCreatedAt
}

function retryableStripeEvent(evt: StripeEvent, message: string): BillingError {
  return new BillingError({
    code: 'webhook_event_unknown',
    message,
    context: { eventId: evt.id },
  })
}

function canonicalBillingEvent(
  evt: StripeEvent,
  previous: SubscriptionRecord,
  current: SubscriptionRecord,
): StripeBillingEvent {
  if (current.state === 'canceled') {
    return { kind: 'subscription.deleted', eventId: evt.id, record: current }
  }
  if (current.state === 'trialing') {
    return { kind: 'subscription.trial_ignored', eventId: evt.id, record: current }
  }
  return {
    kind: 'subscription.updated',
    eventId: evt.id,
    previousState: previous.state,
    record: current,
  }
}

function isProductionRuntime(runtime: IdempotencyRuntime | undefined): boolean {
  if (runtime) return runtime === 'production'
  if (typeof process !== 'undefined' && process.env.VITEST) return false
  const nodeEnv = typeof process !== 'undefined' ? process.env.NODE_ENV : undefined
  return nodeEnv !== 'test' && nodeEnv !== 'development'
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

/**
 * States a subscription cannot leave, so the customer can only return through
 * a new subscription. A `created` event for a different subscription id is a
 * resubscribe from one of these, and a foreign event from any other state.
 */
function isTerminalSubscriptionState(state: SubscriptionState): boolean {
  return state === 'canceled' || state === 'incomplete_expired'
}

function canApplyFreshCreate(state: SubscriptionState): boolean {
  // A 'created' event on a record that already advanced past incomplete means
  // the lifecycle was processed and a retried-late 'created' should be dropped.
  // A terminal state is the exception: it accepts the customer's next
  // subscription, which is the only way back from it.
  return state === 'incomplete' || isTerminalSubscriptionState(state)
}

function extractPriceId(sub: StripeSubscriptionSnapshot): string | null {
  return sub.items?.data?.[0]?.price?.id ?? null
}
