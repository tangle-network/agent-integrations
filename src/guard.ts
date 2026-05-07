import { createHash } from 'node:crypto'
import type {
  IntegrationActionGuard,
  IntegrationActionResult,
  IntegrationGuardContext,
} from './index.js'
import type { IntegrationAuditSink } from './audit.js'
import { createIntegrationAuditEvent } from './audit.js'

export interface IntegrationIdempotencyRecord {
  key: string
  requestHash: string
  result: IntegrationActionResult
  createdAt: string
}

export interface IntegrationIdempotencyStore {
  get(key: string): Promise<IntegrationIdempotencyRecord | undefined> | IntegrationIdempotencyRecord | undefined
  put(record: IntegrationIdempotencyRecord): Promise<void> | void
}

export interface IntegrationRateLimitDecision {
  allowed: boolean
  retryAfterMs?: number
  reason?: string
}

export interface IntegrationRateLimiter {
  check(ctx: IntegrationGuardContext): Promise<IntegrationRateLimitDecision> | IntegrationRateLimitDecision
}

export class InMemoryIntegrationIdempotencyStore implements IntegrationIdempotencyStore {
  private readonly records = new Map<string, IntegrationIdempotencyRecord>()

  get(key: string): IntegrationIdempotencyRecord | undefined {
    return this.records.get(key)
  }

  put(record: IntegrationIdempotencyRecord): void {
    this.records.set(record.key, record)
  }
}

export class DefaultIntegrationActionGuard implements IntegrationActionGuard {
  private readonly idempotency: IntegrationIdempotencyStore | undefined
  private readonly audit: IntegrationAuditSink | undefined
  private readonly rateLimiter: IntegrationRateLimiter | undefined
  private readonly requireIdempotencyForMutations: boolean
  private readonly now: () => Date

  constructor(options: {
    idempotency?: IntegrationIdempotencyStore
    audit?: IntegrationAuditSink
    rateLimiter?: IntegrationRateLimiter
    requireIdempotencyForMutations?: boolean
    now?: () => Date
  } = {}) {
    this.idempotency = options.idempotency
    this.audit = options.audit
    this.rateLimiter = options.rateLimiter
    this.requireIdempotencyForMutations = options.requireIdempotencyForMutations ?? false
    this.now = options.now ?? (() => new Date())
  }

  async invokeAction(ctx: IntegrationGuardContext, proceed: () => Promise<IntegrationActionResult>): Promise<IntegrationActionResult> {
    const idempotencyKey = ctx.request.idempotencyKey
    const requestHash = hashRequest(ctx)
    if (this.requireIdempotencyForMutations && ctx.action?.risk !== 'read' && !idempotencyKey) {
      return {
        ok: false,
        action: ctx.request.action,
        output: {
          idempotencyRequired: true,
          message: 'State-changing integration actions require an idempotency key.',
        },
      }
    }
    if (idempotencyKey && this.idempotency) {
      const existing = await this.idempotency.get(idempotencyKey)
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return {
            ok: false,
            action: ctx.request.action,
            output: { idempotencyConflict: true, message: 'Idempotency key was reused with different integration input.' },
          }
        }
        return {
          ...existing.result,
          metadata: { ...(existing.result.metadata ?? {}), idempotentReplay: true },
        }
      }
    }

    if (ctx.request.dryRun && ctx.action?.risk !== 'read') {
      const result: IntegrationActionResult = {
        ok: true,
        action: ctx.request.action,
        output: { dryRun: true },
        metadata: { dryRun: true },
      }
      await this.writeIdempotency(idempotencyKey, requestHash, result)
      return result
    }

    const rateLimit = await this.rateLimiter?.check(ctx)
    if (rateLimit && !rateLimit.allowed) {
      return {
        ok: false,
        action: ctx.request.action,
        output: { rateLimited: true, retryAfterMs: rateLimit.retryAfterMs, message: rateLimit.reason ?? 'Integration rate limit exceeded.' },
      }
    }

    try {
      const result = await proceed()
      await this.writeIdempotency(idempotencyKey, requestHash, result)
      await this.audit?.record(createIntegrationAuditEvent({
        type: result.ok ? 'action.invoked' : 'action.failed',
        actor: ctx.connection.owner,
        connectionId: ctx.connection.id,
        providerId: ctx.connection.providerId,
        connectorId: ctx.connection.connectorId,
        action: ctx.request.action,
        risk: ctx.action?.risk,
        dataClass: ctx.action?.dataClass,
        ok: result.ok,
        metadata: { idempotencyKey, externalId: result.externalId, warnings: result.warnings },
        now: this.now,
      }))
      return result
    } catch (error) {
      await this.audit?.record(createIntegrationAuditEvent({
        type: 'action.failed',
        actor: ctx.connection.owner,
        connectionId: ctx.connection.id,
        providerId: ctx.connection.providerId,
        connectorId: ctx.connection.connectorId,
        action: ctx.request.action,
        risk: ctx.action?.risk,
        dataClass: ctx.action?.dataClass,
        ok: false,
        message: error instanceof Error ? error.message : 'Integration action failed.',
        metadata: { idempotencyKey },
        now: this.now,
      }))
      throw error
    }
  }

  private async writeIdempotency(key: string | undefined, requestHash: string, result: IntegrationActionResult): Promise<void> {
    if (!key || !this.idempotency) return
    await this.idempotency.put({
      key,
      requestHash,
      result,
      createdAt: this.now().toISOString(),
    })
  }
}

export function createDefaultIntegrationActionGuard(options: ConstructorParameters<typeof DefaultIntegrationActionGuard>[0] = {}): DefaultIntegrationActionGuard {
  return new DefaultIntegrationActionGuard(options)
}

function hashRequest(ctx: IntegrationGuardContext): string {
  return createHash('sha256').update(JSON.stringify({
    connectionId: ctx.connection.id,
    action: ctx.request.action,
    input: ctx.request.input ?? null,
    dryRun: ctx.request.dryRun ?? false,
  })).digest('base64url')
}
