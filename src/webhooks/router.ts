/**
 * @stable Provider-agnostic inbound webhook router.
 *
 * Consumer hooks a single HTTP handler at `/webhook/:provider/:event`
 * (or whatever pathing they prefer) and forwards the request through
 * `WebhookRouter.handle()`. The router:
 *
 *   1. Resolves the registered provider entry.
 *   2. Calls the provider's `verifySignature(rawBody, headers, secrets)`.
 *      Failure → 401 fast, no downstream work.
 *   3. Calls the provider's `parse(rawBody, headers)` to extract zero or
 *      more normalized events.
 *   4. Enqueues each event for async processing via the consumer-supplied
 *      `deliver(event)` callback (best-effort fire-and-forget — the
 *      router does NOT block the HTTP response on the consumer's work).
 *   5. Returns 200 fast with `{received: events.length}`.
 *
 * Replay protection: providers that sign timestamps (Stripe, Slack)
 * already reject stale signatures inside `verifySignature`. For providers
 * that don't (DocuSeal, GDrive push), the router exposes a pluggable
 * `idempotency` hook: if `idempotency.seen(providerEventId)` returns
 * true, the router 200s without invoking `deliver()`. Consumers wire
 * this to a durable kv (D1 / Redis / Postgres unique-index).
 *
 * Why a router and not a per-provider express app: the runtime contract
 * a product cares about is "an inbound event came in, here's the
 * normalized envelope". Verification, parsing, and idempotency-dedup
 * are mechanical and provider-specific — the router owns them. The
 * consumer's `deliver()` is the only place product logic runs.
 *
 * Stability: `@stable` — additions to `WebhookEnvelope` must be
 * additive; the router's HTTP contract (paths, status codes) is frozen
 * at 200 (ok), 400 (bad request), 401 (bad signature), 404 (unknown
 * provider), 405 (provider has no inbound surface).
 */

export interface WebhookHeaders {
  [name: string]: string | string[] | undefined
}

/** Normalized inbound event the router emits after parsing. */
export interface WebhookEnvelope<TPayload = unknown> {
  /** Provider id (matches the `:provider` path segment). */
  provider: string
  /** Optional event class — e.g., 'customer.subscription.deleted'. The
   *  provider's parser decides. Used for routing inside `deliver()`. */
  eventType: string
  /** Provider-emitted event id, when present. Used for the idempotency
   *  short-circuit. */
  providerEventId?: string
  /** Wall-clock receive time. */
  receivedAt: number
  /** Provider payload, normalized to the provider's documented event
   *  shape. The router does NOT reshape this — `parse()` is the contract. */
  payload: TPayload
  /** Headers passed through for downstream handlers that want them
   *  (e.g., to extract custom routing metadata). Always lowercased keys. */
  headers: Record<string, string>
}

export type SignatureVerification =
  | { valid: true }
  | { valid: false; reason: string }

/** Per-provider plug-in. Stateless — the router calls `verifySignature`
 *  then `parse` on every request. The provider's HTTP-shape concerns
 *  (e.g., raw body required) are documented per provider. */
export interface WebhookProvider {
  /** Stable provider id (`stripe`, `docuseal`, `gdrive`, ...). */
  id: string
  /** Verify the inbound signature. Receives the EXACT raw body string —
   *  consumers MUST preserve raw bytes through their HTTP server (do not
   *  parse JSON before forwarding here). */
  verifySignature(input: {
    rawBody: string
    headers: WebhookHeaders
    secret: string
  }): SignatureVerification
  /** Parse the validated raw body into zero or more normalized events.
   *  A single push payload may carry multiple events (e.g., Slack bulk
   *  delivery). Return [] to ack the push as a no-op. */
  parse(input: {
    rawBody: string
    headers: WebhookHeaders
    now?: number
  }): WebhookEnvelope[] | Promise<WebhookEnvelope[]>
}

export interface WebhookIdempotencyStore {
  /** Returns true if this providerEventId has been processed already.
   *  Implementations should be O(1) (Redis SETNX, D1 UNIQUE constraint). */
  seen(providerEventId: string): Promise<boolean> | boolean
  /** Marks a providerEventId as processed. Called AFTER `deliver()` has
   *  been invoked. */
  remember(providerEventId: string, ttlMs: number): Promise<void> | void
}

export interface WebhookRouterOptions {
  /** Provider registry. Pass any number of providers; routing is by id. */
  providers: WebhookProvider[]
  /** Async callback invoked with every accepted event. Fire-and-forget
   *  from the router's perspective — the HTTP response is sent before
   *  this resolves. Throws are caught and reported via `onError`. */
  deliver(event: WebhookEnvelope): Promise<void> | void
  /** Resolve the signing secret for a provider id at request time. The
   *  router never holds secrets — the consumer's vault resolves them. */
  resolveSecret(providerId: string, headers: WebhookHeaders): Promise<string | null> | string | null
  /** Optional idempotency-dedup hook. Required for providers that don't
   *  sign timestamps in their signature scheme (DocuSeal, Drive push). */
  idempotency?: WebhookIdempotencyStore
  /** TTL on idempotency entries. Default 7 days — long enough that a
   *  provider's normal retry-window can't re-deliver. */
  idempotencyTtlMs?: number
  /** Surface delivery errors. Default: console.error. */
  onError?(err: unknown, context: { provider: string; eventType?: string; providerEventId?: string }): void
  /** Override `now()` for tests. */
  now?(): number
}

export interface WebhookRouterRequest {
  providerId: string
  rawBody: string
  headers: WebhookHeaders
}

export interface WebhookRouterResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

/**
 * Router instance. Stateless aside from the provider registry — safe to
 * share across requests; build once per process.
 */
export class WebhookRouter {
  private readonly providers: Map<string, WebhookProvider>
  private readonly deliver: WebhookRouterOptions['deliver']
  private readonly resolveSecret: WebhookRouterOptions['resolveSecret']
  private readonly idempotency?: WebhookIdempotencyStore
  private readonly idempotencyTtlMs: number
  private readonly onError: NonNullable<WebhookRouterOptions['onError']>
  private readonly nowFn: () => number

  constructor(opts: WebhookRouterOptions) {
    this.providers = new Map(opts.providers.map((p) => [p.id, p]))
    this.deliver = opts.deliver
    this.resolveSecret = opts.resolveSecret
    this.idempotency = opts.idempotency
    this.idempotencyTtlMs = opts.idempotencyTtlMs ?? 7 * 24 * 60 * 60 * 1000
    this.onError = opts.onError ?? defaultOnError
    this.nowFn = opts.now ?? Date.now
  }

  /** Process one inbound webhook request. Pure with respect to side-
   *  effects on the router instance — safe to call concurrently. */
  async handle(request: WebhookRouterRequest): Promise<WebhookRouterResponse> {
    const provider = this.providers.get(request.providerId)
    if (!provider) {
      return { status: 404, body: { error: 'unknown_provider', provider: request.providerId } }
    }
    const secret = await this.resolveSecret(provider.id, request.headers)
    if (!secret) {
      return { status: 401, body: { error: 'missing_secret', provider: provider.id } }
    }
    const verification = provider.verifySignature({
      rawBody: request.rawBody,
      headers: request.headers,
      secret,
    })
    if (!verification.valid) {
      return { status: 401, body: { error: 'invalid_signature', reason: verification.reason } }
    }

    let events: WebhookEnvelope[]
    try {
      events = await provider.parse({ rawBody: request.rawBody, headers: request.headers, now: this.nowFn() })
    } catch (err) {
      this.onError(err, { provider: provider.id })
      return { status: 400, body: { error: 'parse_error', message: errMessage(err) } }
    }

    const accepted: WebhookEnvelope[] = []
    for (const event of events) {
      if (event.providerEventId && this.idempotency) {
        const already = await this.idempotency.seen(event.providerEventId)
        if (already) continue
      }
      accepted.push(event)
    }

    // Deliver async — do NOT block the HTTP response. Errors land in
    // `onError`; the provider already got its 200 by then so it will
    // not retry.
    queueMicrotask(() => {
      void this.deliverEach(accepted)
    })

    return { status: 200, body: { received: accepted.length, total: events.length } }
  }

  private async deliverEach(events: WebhookEnvelope[]): Promise<void> {
    for (const event of events) {
      try {
        await this.deliver(event)
        if (event.providerEventId && this.idempotency) {
          await this.idempotency.remember(event.providerEventId, this.idempotencyTtlMs)
        }
      } catch (err) {
        this.onError(err, {
          provider: event.provider,
          eventType: event.eventType,
          providerEventId: event.providerEventId,
        })
      }
    }
  }
}

function defaultOnError(err: unknown, context: { provider: string; eventType?: string; providerEventId?: string }): void {
  // eslint-disable-next-line no-console
  console.error('[WebhookRouter]', context, err)
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
