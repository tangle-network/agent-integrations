import { createHash, randomUUID } from 'node:crypto'

export type IdempotencyRuntime = 'production' | 'development' | 'test'

/**
 * Atomic claim storage shared by every worker that can receive the same event.
 * `scope` is part of the construction contract so production cannot silently
 * accept a process-local implementation.
 */
export interface AtomicIdempotencyStore {
  readonly scope?: 'process' | 'shared'
  claim(key: string, ttlMs: number): Promise<boolean> | boolean
  release?(key: string): Promise<void> | void
  /** Retain a successful claim while clearing only local ownership state. */
  complete?(key: string): Promise<void> | void
}

/** Process-local implementation for tests and explicitly single-process apps. */
export class InMemoryAtomicIdempotencyStore implements AtomicIdempotencyStore {
  readonly scope = 'process' as const
  private readonly entries = new Map<string, { expiresAt: number; token: string }>()
  private readonly owners = new Map<string, string>()

  claim(key: string, ttlMs: number): boolean {
    assertClaimInput(key, ttlMs)
    // A long-running handler must not reclaim its own expired key while the
    // original delivery can still call release. A fresh process may reclaim
    // an expired durable claim; this local guard only preserves ownership
    // within one process.
    if (this.owners.has(key)) return false
    const now = Date.now()
    const existing = this.entries.get(key)
    if (existing && existing.expiresAt > now) return false

    const token = randomUUID()
    this.entries.set(key, { expiresAt: now + ttlMs, token })
    this.owners.set(key, token)
    return true
  }

  release(key: string): void {
    assertKey(key)
    const token = this.owners.get(key)
    if (!token) return
    const current = this.entries.get(key)
    if (current?.token === token) this.entries.delete(key)
    if (this.owners.get(key) === token) this.owners.delete(key)
  }

  complete(key: string): void {
    assertKey(key)
    this.owners.delete(key)
  }
}

export interface FileSystemAtomicIdempotencyStoreOptions {
  /** Optional path-safe filename namespace for colocated stores. */
  namespace?: string
  /** Maximum time to wait for another worker's per-key lock. */
  lockWaitMs?: number
  /** Lease used to recover a lock left by a crashed worker. */
  lockLeaseMs?: number
}

interface ClaimRecord {
  version: 1
  keyHash: string
  token: string
  expiresAt: number
}

interface LockRecord {
  token: string
  expiresAt: number
}

/**
 * Durable file-per-key claims using the repository's existing filesystem
 * persistence convention. The state write is atomic, and an exclusive lock
 * serializes read/replace decisions across worker processes.
 *
 * All workers must use the same shared filesystem directory. A lock left by a
 * crashed worker is recoverable after its lease expires; malformed files fail
 * closed instead of risking a duplicate claim.
 */
export class FileSystemAtomicIdempotencyStore implements AtomicIdempotencyStore {
  readonly scope = 'shared' as const
  private readonly lockWaitMs: number
  private readonly lockLeaseMs: number
  private readonly filePrefix: string
  private readonly owners = new Map<string, string>()

  constructor(
    private readonly rootDir: string,
    options: FileSystemAtomicIdempotencyStoreOptions = {},
  ) {
    if (!rootDir.trim()) throw new Error('FileSystemAtomicIdempotencyStore requires a root directory')
    if (options.namespace !== undefined && !/^[A-Za-z0-9_.-]+$/.test(options.namespace)) {
      throw new Error('Idempotency namespace must contain only path-safe characters')
    }
    this.filePrefix = options.namespace ? `${options.namespace}-` : ''
    this.lockWaitMs = positiveOption(options.lockWaitMs ?? 30_000, 'lockWaitMs')
    this.lockLeaseMs = positiveOption(options.lockLeaseMs ?? 60_000, 'lockLeaseMs')
    if (this.lockLeaseMs <= 0) throw new Error('lockLeaseMs must be positive')
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    assertClaimInput(key, ttlMs)
    // See the in-memory implementation: do not let one worker replace its
    // own live handler's claim after expiry and then release the replacement.
    if (this.owners.has(key)) return false
    const keyHash = hashKey(key)
    return this.withLock(keyHash, async () => {
      const file = await this.statePath(keyHash)
      const current = await this.readState(file, keyHash)
      const now = Date.now()
      if (current && current.expiresAt > now) return false

      const token = randomUUID()
      await this.writeState(file, {
        version: 1,
        keyHash,
        token,
        expiresAt: now + ttlMs,
      })
      this.owners.set(key, token)
      return true
    })
  }

  async release(key: string): Promise<void> {
    assertKey(key)
    const token = this.owners.get(key)
    if (!token) return

    const keyHash = hashKey(key)
    await this.withLock(keyHash, async () => {
      const file = await this.statePath(keyHash)
      const current = await this.readState(file, keyHash)
      if (current?.token === token) await this.removeState(file)
      if (this.owners.get(key) === token) this.owners.delete(key)
    })
  }

  complete(key: string): void {
    assertKey(key)
    this.owners.delete(key)
  }

  private async statePath(keyHash: string): Promise<string> {
    const path = await import('node:path')
    return path.join(this.rootDir, `${this.filePrefix}${keyHash}.json`)
  }

  private async lockPath(keyHash: string): Promise<string> {
    const path = await import('node:path')
    return path.join(this.rootDir, `${this.filePrefix}${keyHash}.lock`)
  }

  private async ensureRoot(): Promise<void> {
    const fs = await import('node:fs/promises')
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 })
  }

  private async readState(file: string, expectedKeyHash: string): Promise<ClaimRecord | null> {
    const fs = await import('node:fs/promises')
    let raw: string
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch (err) {
      if (isNodeENOENT(err)) return null
      throw err
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`Invalid idempotency state for ${expectedKeyHash}`)
    }
    if (!isClaimRecord(parsed) || parsed.keyHash !== expectedKeyHash) {
      throw new Error(`Invalid idempotency state for ${expectedKeyHash}`)
    }
    return parsed
  }

  private async writeState(file: string, record: ClaimRecord): Promise<void> {
    const fs = await import('node:fs/promises')
    const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await fs.writeFile(tmp, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
    try {
      await fs.rename(tmp, file)
    } catch (err) {
      await removeIfPresent(tmp)
      throw err
    }
  }

  private async removeState(file: string): Promise<void> {
    const fs = await import('node:fs/promises')
    try {
      await fs.unlink(file)
    } catch (err) {
      if (!isNodeENOENT(err)) throw err
    }
  }

  private async withLock<T>(keyHash: string, work: () => Promise<T>): Promise<T> {
    await this.ensureRoot()
    const fs = await import('node:fs/promises')
    const lockFile = await this.lockPath(keyHash)
    const startedAt = Date.now()

    while (true) {
      const token = randomUUID()
      let handle: import('node:fs/promises').FileHandle | undefined
      try {
        handle = await fs.open(lockFile, 'wx', 0o600)
        const lock: LockRecord = { token, expiresAt: Date.now() + this.lockLeaseMs }
        await handle.writeFile(JSON.stringify(lock), 'utf8')
        await handle.close()
        handle = undefined

        try {
          return await work()
        } finally {
          await this.releaseLock(lockFile, token)
        }
      } catch (err) {
        if (handle) await handle.close().catch(() => undefined)
        if (!isNodeEEXIST(err)) throw err

        const current = await this.readLock(lockFile)
        if (current && current.expiresAt <= Date.now()) {
          await this.reclaimExpiredLock(lockFile)
          continue
        }
        if (Date.now() - startedAt >= this.lockWaitMs) {
          throw new Error(`Timed out acquiring idempotency lock for ${keyHash}`)
        }
        await delay(5)
      }
    }
  }

  private async readLock(file: string): Promise<LockRecord | null> {
    const fs = await import('node:fs/promises')
    let raw: string
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch (err) {
      if (isNodeENOENT(err)) return null
      throw err
    }
    if (!raw.trim()) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Invalid idempotency lock')
    }
    if (!isLockRecord(parsed)) throw new Error('Invalid idempotency lock')
    return parsed
  }

  private async reclaimExpiredLock(file: string): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const stale = path.join(this.rootDir, `${path.basename(file)}.stale-${randomUUID()}`)
    try {
      await fs.rename(file, stale)
      await fs.unlink(stale)
    } catch (err) {
      if (!isNodeENOENT(err)) throw err
    }
  }

  private async releaseLock(file: string, token: string): Promise<void> {
    const current = await this.readLock(file)
    if (current?.token !== token) return
    const fs = await import('node:fs/promises')
    try {
      await fs.unlink(file)
    } catch (err) {
      if (!isNodeENOENT(err)) throw err
    }
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

function isClaimRecord(value: unknown): value is ClaimRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ClaimRecord>
  return candidate.version === 1
    && typeof candidate.keyHash === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.keyHash)
    && typeof candidate.token === 'string'
    && candidate.token.length > 0
    && Number.isFinite(candidate.expiresAt)
}

function isLockRecord(value: unknown): value is LockRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LockRecord>
  return typeof candidate.token === 'string'
    && candidate.token.length > 0
    && Number.isFinite(candidate.expiresAt)
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

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
