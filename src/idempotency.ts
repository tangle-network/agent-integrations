import { createHash, randomUUID } from 'node:crypto'

export type IdempotencyRuntime = 'production' | 'development' | 'test'

export type AtomicClaimStatus = 'acquired' | 'in_progress' | 'completed'

/**
 * Atomic claim storage shared by every worker that can receive the same event.
 * `claimStatus` distinguishes a finished replay from concurrent work. HTTP
 * handlers need that distinction so they never acknowledge another worker's
 * unfinished attempt.
 */
export interface AtomicIdempotencyStore {
  readonly scope?: 'process' | 'shared'
  claim(key: string, ttlMs: number): Promise<boolean> | boolean
  claimStatus(key: string, ttlMs: number): Promise<AtomicClaimStatus> | AtomicClaimStatus
  release(key: string): Promise<void> | void
  /** Retain a successful claim while clearing only local ownership state. */
  complete(key: string): Promise<void> | void
}

interface InMemoryClaim {
  expiresAt: number
  token: string
  status: 'processing' | 'completed'
}

/** Process-local implementation for tests and explicitly single-process apps. */
export class InMemoryAtomicIdempotencyStore implements AtomicIdempotencyStore {
  readonly scope = 'process' as const
  private readonly entries = new Map<string, InMemoryClaim>()
  private readonly owners = new Map<string, string>()

  claim(key: string, ttlMs: number): boolean {
    return this.claimStatus(key, ttlMs) === 'acquired'
  }

  claimStatus(key: string, ttlMs: number): AtomicClaimStatus {
    assertClaimInput(key, ttlMs)
    if (this.owners.has(key)) return 'in_progress'
    const now = Date.now()
    const existing = this.entries.get(key)
    if (existing && existing.expiresAt > now) {
      return existing.status === 'completed' ? 'completed' : 'in_progress'
    }

    const token = randomUUID()
    this.entries.set(key, { expiresAt: now + ttlMs, token, status: 'processing' })
    this.owners.set(key, token)
    return 'acquired'
  }

  release(key: string): void {
    assertKey(key)
    const token = this.owners.get(key)
    if (!token) return
    const current = this.entries.get(key)
    if (current?.token === token && current.status === 'processing') this.entries.delete(key)
    if (this.owners.get(key) === token) this.owners.delete(key)
  }

  complete(key: string): void {
    assertKey(key)
    const token = this.owners.get(key)
    if (!token) return
    const current = this.entries.get(key)
    if (current?.token === token) current.status = 'completed'
    if (this.owners.get(key) === token) this.owners.delete(key)
  }
}

export interface FileSystemAtomicIdempotencyStoreOptions {
  /** Optional path-safe filename namespace for colocated stores. */
  namespace?: string
  /** Lease for work in progress. Active owners renew it until completion. */
  processingLeaseMs?: number
  /** Renewal cadence. Must be shorter than `processingLeaseMs`. */
  heartbeatIntervalMs?: number
  /** @deprecated Use `processingLeaseMs`. Preserved for existing callers. */
  lockLeaseMs?: number
  /** @deprecated Append-only claims do not wait on a lock. */
  lockWaitMs?: number
}

interface LegacyClaimRecord {
  version: 1
  keyHash: string
  token: string
  expiresAt: number
}

interface ClaimJournalNode {
  version: 3
  kind: 'claim' | 'completed' | 'available'
  keyHash: string
  token: string
  predecessorToken: string | null
  ownerToken: string | null
  expiresAt: number
}

type StoredClaimRecord = LegacyClaimRecord | ClaimJournalNode

interface LocalClaimOwner {
  ownerToken: string
  ttlMs: number
  timer?: ReturnType<typeof setInterval>
  renewing: boolean
  closing: boolean
}

const MAX_CLAIM_CHAIN_DEPTH = 100_000

/**
 * Durable append-only claim journal.
 *
 * Every decision is linked to one deterministic path derived from the prior
 * node token. Renewal, completion, release, and takeover therefore race the
 * same atomic hard-link. Only one decision can win. Active owners renew a
 * processing lease; a crashed process stops renewing and becomes recoverable.
 * A stale process cannot complete or release a successor's claim.
 *
 * Version-1 state cannot distinguish active work from completion. It is read as
 * in progress until expiry, so a rolling deployment never acknowledges work
 * that an older process may still own. New state is never replaced or deleted.
 */
export class FileSystemAtomicIdempotencyStore implements AtomicIdempotencyStore {
  readonly scope = 'shared' as const
  private readonly filePrefix: string
  private readonly processingLeaseMs: number
  private readonly heartbeatIntervalMs: number
  private readonly owners = new Map<string, LocalClaimOwner>()

  constructor(
    private readonly rootDir: string,
    options: FileSystemAtomicIdempotencyStoreOptions = {},
  ) {
    if (!rootDir.trim()) throw new Error('FileSystemAtomicIdempotencyStore requires a root directory')
    if (options.namespace !== undefined && !/^[A-Za-z0-9_.-]+$/.test(options.namespace)) {
      throw new Error('Idempotency namespace must contain only path-safe characters')
    }
    if (options.lockWaitMs !== undefined) positiveOption(options.lockWaitMs, 'lockWaitMs')
    this.filePrefix = options.namespace ? `${options.namespace}-` : ''
    this.processingLeaseMs = positiveOption(
      options.processingLeaseMs ?? options.lockLeaseMs ?? 60_000,
      'processingLeaseMs',
    )
    this.heartbeatIntervalMs = positiveOption(
      options.heartbeatIntervalMs ?? Math.max(1, Math.floor(this.processingLeaseMs / 3)),
      'heartbeatIntervalMs',
    )
    if (this.heartbeatIntervalMs >= this.processingLeaseMs) {
      throw new Error('heartbeatIntervalMs must be shorter than processingLeaseMs')
    }
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    return (await this.claimStatus(key, ttlMs)) === 'acquired'
  }

  async claimStatus(key: string, ttlMs: number): Promise<AtomicClaimStatus> {
    assertClaimInput(key, ttlMs)
    if (this.owners.has(key)) return 'in_progress'
    await this.ensureRoot()
    const keyHash = hashKey(key)

    while (true) {
      const head = await this.readHead(keyHash)
      const now = Date.now()
      if (!head) {
        const ownerToken = randomUUID()
        const record = this.claimNode(keyHash, null, ownerToken, now)
        if (!(await this.writeExclusive(await this.rootPath(keyHash), record))) continue
        this.startOwnership(key, ownerToken, ttlMs)
        return 'acquired'
      }

      if (head.version === 1) {
        if (head.expiresAt > now) return 'in_progress'
      } else {
        if (head.kind === 'completed' && head.expiresAt > now) return 'completed'
        if (head.kind === 'claim' && head.expiresAt > now) return 'in_progress'
      }

      const ownerToken = randomUUID()
      const successor = this.claimNode(keyHash, head.token, ownerToken, now)
      if (!(await this.writeExclusive(await this.successorPath(keyHash, head.token), successor))) continue
      this.startOwnership(key, ownerToken, ttlMs)
      return 'acquired'
    }
  }

  async release(key: string): Promise<void> {
    await this.transitionOwned(key, 'available')
  }

  async complete(key: string): Promise<void> {
    await this.transitionOwned(key, 'completed')
  }

  private async transitionOwned(key: string, kind: 'completed' | 'available'): Promise<void> {
    assertKey(key)
    const owner = this.owners.get(key)
    if (!owner) return
    owner.closing = true
    this.stopHeartbeat(owner)
    const keyHash = hashKey(key)
    try {
      while (true) {
        const head = await this.readHead(keyHash)
        if (
          !head
          || head.version === 1
          || head.kind !== 'claim'
          || head.ownerToken !== owner.ownerToken
        ) {
          this.owners.delete(key)
          if (kind === 'completed') {
            throw new Error(`Idempotency ownership was lost before completion for ${key}`)
          }
          return
        }

        const next: ClaimJournalNode = {
          version: 3,
          kind,
          keyHash,
          token: randomUUID(),
          predecessorToken: head.token,
          ownerToken: owner.ownerToken,
          expiresAt: kind === 'completed' ? Date.now() + owner.ttlMs : 0,
        }
        if (!(await this.writeExclusive(await this.successorPath(keyHash, head.token), next))) continue
        this.owners.delete(key)
        return
      }
    } catch (err) {
      if (this.owners.get(key) === owner) {
        if (kind === 'available') {
          this.owners.delete(key)
        } else {
          owner.closing = false
          this.scheduleHeartbeat(key, owner)
        }
      }
      throw err
    }
  }

  private async readHead(keyHash: string): Promise<StoredClaimRecord | null> {
    let current = await this.readClaim(await this.rootPath(keyHash), keyHash)
    if (!current) return null
    for (let depth = 0; depth < MAX_CLAIM_CHAIN_DEPTH; depth++) {
      const next = await this.readClaim(await this.successorPath(keyHash, current.token), keyHash)
      if (!next) return current
      if (next.version !== 3 || next.predecessorToken !== current.token) {
        throw new Error(`Invalid idempotency successor for ${keyHash}`)
      }
      current = next
    }
    throw new Error(`Idempotency claim chain exceeds ${MAX_CLAIM_CHAIN_DEPTH} records for ${keyHash}`)
  }

  private async readClaim(file: string, expectedKeyHash: string): Promise<StoredClaimRecord | null> {
    const parsed = await this.readJson(file)
    if (parsed === null) return null
    if (!isClaimRecord(parsed) || parsed.keyHash !== expectedKeyHash) {
      throw new Error(`Invalid idempotency state for ${expectedKeyHash}`)
    }
    return parsed
  }

  private claimNode(
    keyHash: string,
    predecessorToken: string | null,
    ownerToken: string,
    now: number,
  ): ClaimJournalNode {
    return {
      version: 3,
      kind: 'claim',
      keyHash,
      token: randomUUID(),
      predecessorToken,
      ownerToken,
      expiresAt: now + this.processingLeaseMs,
    }
  }

  private startOwnership(key: string, ownerToken: string, ttlMs: number): void {
    const owner: LocalClaimOwner = { ownerToken, ttlMs, renewing: false, closing: false }
    this.owners.set(key, owner)
    this.scheduleHeartbeat(key, owner)
  }

  private scheduleHeartbeat(key: string, owner: LocalClaimOwner): void {
    if (owner.timer || owner.closing || this.owners.get(key) !== owner) return
    owner.timer = setInterval(() => {
      void this.renewOwnership(key, owner).catch(() => undefined)
    }, this.heartbeatIntervalMs)
    owner.timer.unref?.()
  }

  private stopHeartbeat(owner: LocalClaimOwner): void {
    if (owner.timer) clearInterval(owner.timer)
    owner.timer = undefined
  }

  private async renewOwnership(key: string, owner: LocalClaimOwner): Promise<void> {
    if (owner.renewing || owner.closing || this.owners.get(key) !== owner) return
    owner.renewing = true
    try {
      const keyHash = hashKey(key)
      while (!owner.closing && this.owners.get(key) === owner) {
        const head = await this.readHead(keyHash)
        if (
          !head
          || head.version === 1
          || head.kind !== 'claim'
          || head.ownerToken !== owner.ownerToken
        ) {
          this.stopHeartbeat(owner)
          return
        }
        const renewal = this.claimNode(keyHash, head.token, owner.ownerToken, Date.now())
        if (await this.writeExclusive(await this.successorPath(keyHash, head.token), renewal)) return
      }
    } finally {
      owner.renewing = false
    }
  }

  private async readJson(file: string): Promise<unknown | null> {
    const fs = await import('node:fs/promises')
    let raw: string
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch (err) {
      if (isNodeENOENT(err)) return null
      throw err
    }
    try {
      return JSON.parse(raw) as unknown
    } catch {
      throw new Error(`Invalid idempotency JSON at ${file}`)
    }
  }

  private async writeExclusive(file: string, value: object): Promise<boolean> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`
    const handle = await fs.open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(value), 'utf8')
      await handle.sync()
      await handle.close()
      try {
        await fs.link(tmp, file)
        await syncDirectory(path.dirname(file))
        return true
      } catch (err) {
        if (isNodeEEXIST(err)) return false
        throw err
      }
    } finally {
      await handle.close().catch(() => undefined)
      await removeIfPresent(tmp)
    }
  }

  private async rootPath(keyHash: string): Promise<string> {
    const path = await import('node:path')
    return path.join(this.rootDir, `${this.filePrefix}${keyHash}.json`)
  }

  private async successorPath(keyHash: string, predecessorToken: string): Promise<string> {
    const path = await import('node:path')
    return path.join(
      this.rootDir,
      `${this.filePrefix}${keyHash}.next-${hashToken(predecessorToken)}.json`,
    )
  }

  private async ensureRoot(): Promise<void> {
    const fs = await import('node:fs/promises')
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 })
  }
}

export interface ResolveAtomicIdempotencyStoreOptions {
  component: string
  store?: AtomicIdempotencyStore
  runtime?: IdempotencyRuntime
}

/**
 * Resolve the safe default for a caller. Production has no implicit fallback:
 * the caller must inject a store that declares shared atomic scope.
 */
export function resolveAtomicIdempotencyStore(options: ResolveAtomicIdempotencyStoreOptions): AtomicIdempotencyStore {
  const runtime = options.runtime ?? currentRuntime()
  if (isProductionEnvironment() && runtime !== 'production') {
    throw new Error(`${options.component}: production environment cannot use a non-production idempotency runtime`)
  }
  if (options.store) {
    if (runtime === 'production' && options.store.scope !== 'shared') {
      throw new Error(`${options.component}: production requires a shared atomic idempotency store`)
    }
    return options.store
  }
  if (runtime === 'production') {
    throw new Error(`${options.component}: shared atomic idempotency store is required in production`)
  }
  return new InMemoryAtomicIdempotencyStore()
}

function currentRuntime(): IdempotencyRuntime {
  if (typeof process !== 'undefined' && process.env.VITEST) return 'test'
  const nodeEnv = typeof process !== 'undefined' ? process.env.NODE_ENV : undefined
  if (nodeEnv === 'test') return 'test'
  if (nodeEnv === 'development') return 'development'
  return 'production'
}

function isProductionEnvironment(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
}

function assertClaimInput(key: string, ttlMs: number): void {
  assertKey(key)
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Idempotency TTL must be a positive finite number')
  if (!Number.isFinite(Date.now() + ttlMs)) throw new Error('Idempotency TTL exceeds the supported clock range')
}

function assertKey(key: string): void {
  if (typeof key !== 'string' || !key.trim()) throw new Error('Idempotency key must be a non-empty string')
}

function positiveOption(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`)
  return value
}

function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function isClaimRecord(value: unknown): value is StoredClaimRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  const common = typeof candidate.keyHash === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.keyHash)
    && typeof candidate.token === 'string'
    && candidate.token.length > 0
    && Number.isFinite(candidate.expiresAt)
  if (!common) return false
  if (candidate.version === 1) return true
  if (candidate.version !== 3) return false
  if (candidate.kind !== 'claim' && candidate.kind !== 'completed' && candidate.kind !== 'available') return false
  if (
    candidate.predecessorToken !== null
    && (typeof candidate.predecessorToken !== 'string' || !candidate.predecessorToken.length)
  ) return false
  if (candidate.kind === 'claim' || candidate.kind === 'completed') {
    return typeof candidate.ownerToken === 'string' && candidate.ownerToken.length > 0
  }
  return candidate.ownerToken === null || (typeof candidate.ownerToken === 'string' && candidate.ownerToken.length > 0)
}

function isNodeENOENT(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT'
}

function isNodeEEXIST(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'EEXIST'
}

async function removeIfPresent(file: string): Promise<void> {
  const fs = await import('node:fs/promises')
  try {
    await fs.unlink(file)
  } catch (err) {
    if (!isNodeENOENT(err)) throw err
  }
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
