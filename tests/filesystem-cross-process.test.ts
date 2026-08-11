import { spawn, type ChildProcess } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileSystemAtomicIdempotencyStore } from '../src/idempotency'
import {
  FileSystemSubscriptionStore,
  makeSubscriptionRecord,
  type SubscriptionRecord,
} from '../src/stripe/subscription-state'

const idempotencyModule = pathToFileURL(resolve('dist/idempotency.js')).href
const subscriptionModule = pathToFileURL(resolve('dist/stripe/index.js')).href
const testRoots: string[] = []

const idempotencyWorker = `
import { FileSystemAtomicIdempotencyStore } from ${JSON.stringify(idempotencyModule)}

const store = new FileSystemAtomicIdempotencyStore(process.env.STORE_ROOT, {
  processingLeaseMs: Number(process.env.LEASE_MS ?? 60000),
  heartbeatIntervalMs: Number(process.env.HEARTBEAT_MS ?? 20000),
})
const key = process.env.CLAIM_KEY
const ttlMs = Number(process.env.TTL_MS ?? 60000)
const mode = process.env.WORKER_MODE ?? 'claim'

function send(message) {
  return new Promise((resolve) => process.send(message, resolve))
}

await send({ type: 'ready' })
process.once('message', async (message) => {
  if (message !== 'go') return
  const acquired = await store.claim(key, ttlMs)
  await send({ type: 'claimed', acquired })
  if (!acquired || mode === 'claim') return process.exit(0)

  if (mode === 'hold') {
    process.once('message', async (next) => {
      if (next !== 'complete') return
      await store.complete(key)
      await send({ type: 'completed' })
      process.exit(0)
    })
    return
  }

  if (mode === 'stale') {
    process.once('message', async (next) => {
      if (next !== 'block') return
      await send({ type: 'blocking' })
      const until = Date.now() + Number(process.env.BLOCK_MS ?? 250)
      while (Date.now() < until) Math.sqrt(81)
      try {
        await store.complete(key)
        await send({ type: 'stale_complete', outcome: 'completed' })
      } catch (error) {
        await send({ type: 'stale_complete', outcome: 'fenced', message: String(error) })
      }
      process.exit(0)
    })
  }
})
`

const subscriptionWorker = `
import { FileSystemSubscriptionStore } from ${JSON.stringify(subscriptionModule)}

const store = new FileSystemSubscriptionStore(process.env.STORE_ROOT)
const candidate = JSON.parse(process.env.CANDIDATE)

function send(message) {
  return new Promise((resolve) => process.send(message, resolve))
}

await send({ type: 'ready' })
process.once('message', async (message) => {
  if (message !== 'go') return
  const written = await store.saveIfVersion(candidate, 0)
  await send({ type: 'written', written, eventId: candidate.lastEventId })
  process.exit(0)
})
`

beforeAll(async () => {
  await runCommand('pnpm', ['build'])
}, 30_000)

afterAll(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(testRoots.map((root) => rm(root, { recursive: true, force: true })))
})

describe('filesystem stores across processes', () => {
  it('allows one claim winner across separate Node processes', async () => {
    const root = resolve(await temporaryDirectory('claim-race'))
    const workers = Array.from({ length: 16 }, () => startWorker(idempotencyWorker, {
      STORE_ROOT: root,
      CLAIM_KEY: 'cross-process-claim',
      WORKER_MODE: 'claim',
    }))
    await Promise.all(workers.map((worker) => waitForMessage(worker, 'ready')))
    const results = workers.map((worker) => waitForMessage<{ acquired: boolean }>(worker, 'claimed'))
    workers.forEach((worker) => worker.send('go'))

    const claims = await Promise.all(results)
    expect(claims.filter((result) => result.acquired)).toHaveLength(1)
    expect(claims.filter((result) => !result.acquired)).toHaveLength(15)
    await Promise.all(workers.map(waitForExit))
  }, 20_000)

  it('renews an active owner beyond its lease and blocks a second process', async () => {
    const root = resolve(await temporaryDirectory('over-lease'))
    const owner = startWorker(idempotencyWorker, {
      STORE_ROOT: root,
      CLAIM_KEY: 'over-lease-active',
      WORKER_MODE: 'hold',
      LEASE_MS: '90',
      HEARTBEAT_MS: '20',
    })
    await waitForMessage(owner, 'ready')
    const claimed = waitForMessage<{ acquired: boolean }>(owner, 'claimed')
    owner.send('go')
    expect((await claimed).acquired).toBe(true)

    await delay(280)
    const contender = new FileSystemAtomicIdempotencyStore(root, {
      processingLeaseMs: 90,
      heartbeatIntervalMs: 20,
    })
    expect(await contender.claim('over-lease-active', 60_000)).toBe(false)

    const completed = waitForMessage(owner, 'completed')
    owner.send('complete')
    await completed
    expect(await contender.claimStatus('over-lease-active', 60_000)).toBe('completed')
    await waitForExit(owner)
  }, 20_000)

  it('fences a stalled owner after a successor takes over', async () => {
    const root = resolve(await temporaryDirectory('stale-owner'))
    const stale = startWorker(idempotencyWorker, {
      STORE_ROOT: root,
      CLAIM_KEY: 'stale-owner',
      WORKER_MODE: 'stale',
      LEASE_MS: '80',
      HEARTBEAT_MS: '20',
      BLOCK_MS: '260',
    })
    await waitForMessage(stale, 'ready')
    const claimed = waitForMessage<{ acquired: boolean }>(stale, 'claimed')
    stale.send('go')
    expect((await claimed).acquired).toBe(true)
    const blocking = waitForMessage(stale, 'blocking')
    const staleCompletion = waitForMessage<{ outcome: string; message?: string }>(stale, 'stale_complete')
    stale.send('block')
    await blocking

    await delay(150)
    const successor = new FileSystemAtomicIdempotencyStore(root, {
      processingLeaseMs: 80,
      heartbeatIntervalMs: 20,
    })
    expect(await successor.claim('stale-owner', 60_000)).toBe(true)
    const staleResult = await staleCompletion
    expect(staleResult.outcome).toBe('fenced')
    expect(staleResult.message).toContain('ownership was lost')
    expect(await successor.claimStatus('stale-owner', 60_000)).toBe('in_progress')
    await successor.complete('stale-owner')
    expect(await successor.claimStatus('stale-owner', 60_000)).toBe('completed')
    await waitForExit(stale)
  }, 20_000)

  it('allows one subscription CAS winner across separate Node processes', async () => {
    const root = resolve(await temporaryDirectory('subscription-cas'))
    const store = new FileSystemSubscriptionStore(root)
    const base = makeSubscriptionRecord({
      workspaceId: 'workspace_cross_process',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      state: 'active',
      priceId: 'price_1',
      currentPeriodEnd: 1,
      eventCreatedAt: 1,
    })
    await store.save(base)

    const candidates: SubscriptionRecord[] = Array.from({ length: 16 }, (_, index) => ({
      ...base,
      state: 'past_due',
      version: 1,
      lastEventId: `evt_${index}`,
      lastEventCreatedAt: index + 2,
      updatedAt: index + 2,
    }))
    const workers = candidates.map((candidate) => startWorker(subscriptionWorker, {
      STORE_ROOT: root,
      CANDIDATE: JSON.stringify(candidate),
    }))
    await Promise.all(workers.map((worker) => waitForMessage(worker, 'ready')))
    const results = workers.map((worker) => waitForMessage<{ written: boolean; eventId: string }>(worker, 'written'))
    workers.forEach((worker) => worker.send('go'))

    const writes = await Promise.all(results)
    expect(writes.filter((result) => result.written)).toHaveLength(1)
    const winner = writes.find((result) => result.written)!
    expect((await store.load('workspace_cross_process'))?.lastEventId).toBe(winner.eventId)
    await Promise.all(workers.map(waitForExit))
  }, 20_000)
})

interface TestWorker extends ChildProcess {
  stderrText: string
}

function startWorker(source: string, extraEnv: Record<string, string>): TestWorker {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv }
  delete env.FORCE_COLOR
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  }) as TestWorker
  child.stderrText = ''
  child.stderr?.on('data', (chunk) => { child.stderrText += String(chunk) })
  return child
}

function waitForMessage<T extends object = Record<string, never>>(
  child: TestWorker,
  type: string,
): Promise<T> {
  return new Promise((resolveMessage, rejectMessage) => {
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== type) return
      cleanup()
      resolveMessage(message as T)
    }
    const onError = (error: Error) => {
      cleanup()
      rejectMessage(error)
    }
    const onExit = (code: number | null) => {
      cleanup()
      rejectMessage(new Error(`worker exited ${code}: ${child.stderrText}`))
    }
    const cleanup = () => {
      child.off('message', onMessage)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    child.on('message', onMessage)
    child.on('error', onError)
    child.on('exit', onExit)
  })
}

function waitForExit(child: TestWorker): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', (code) => {
      if (code === 0) resolveExit()
      else rejectExit(new Error(`worker exited ${code}: ${child.stderrText}`))
    })
  })
}

async function temporaryDirectory(label: string): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), `agent-integrations-${label}-`))
  testRoots.push(root)
  return root
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: 'pipe' })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', rejectCommand)
    child.once('exit', (code) => {
      if (code === 0) resolveCommand()
      else rejectCommand(new Error(`${command} exited ${code}: ${stderr}`))
    })
  })
}
