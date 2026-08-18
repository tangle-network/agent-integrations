import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SUBPATHS = [
  {
    name: 'worker',
    file: 'dist/worker.js',
    smoke: smokeWorker,
  },
  {
    name: 'specs',
    file: 'dist/specs.js',
    smoke: smokeSpecs,
  },
  {
    name: 'catalog',
    file: 'dist/catalog.js',
    smoke: smokeCatalog,
  },
] as const

describe.sequential('packed Worker-safe package subpaths', () => {
  it('packs every public subpath and runs each as a browser Worker bundle', async () => {
    const root = join(tmpdir(), `agent-integrations-pack-${createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 12)}`)
    const packageArchiveDirectory = join(root, 'archive')
    const unpackDirectory = join(root, 'unpacked')
    const bundleDirectory = join(root, 'bundles')
    mkdirSync(packageArchiveDirectory, { recursive: true })
    mkdirSync(unpackDirectory, { recursive: true })
    mkdirSync(bundleDirectory, { recursive: true })

    try {
      const pack = spawnSync(
        'pnpm',
        ['pack', '--pack-destination', packageArchiveDirectory, '--silent'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      )
      expect(pack.status, `${pack.stdout}\n${pack.stderr}`).toBe(0)

      const archiveName = readdirSync(packageArchiveDirectory).find((name) => name.endsWith('.tgz'))
      expect(archiveName).toBeDefined()
      execFileSync('tar', ['-xzf', join(packageArchiveDirectory, archiveName!), '-C', unpackDirectory])

      const packageDirectory = join(unpackDirectory, 'package')
      for (const subpath of SUBPATHS) {
        const input = join(packageDirectory, subpath.file)
        const outfile = join(bundleDirectory, `${subpath.name}.js`)
        const globalName = `__agentIntegrations_${subpath.name}`
        const result = await build({
          entryPoints: [input],
          outfile,
          bundle: true,
          platform: 'browser',
          format: 'iife',
          globalName,
          target: 'es2022',
          packages: 'bundle',
          external: [],
          metafile: true,
          sourcemap: false,
          logLevel: 'silent',
        })

        const externalImports = Object.values(result.metafile?.inputs ?? {})
          .flatMap((inputMetadata) => inputMetadata.imports)
          .filter((entry) => entry.external)
          .map((entry) => entry.path)
        expect(externalImports, `${subpath.name} external imports`).toEqual([])

        const bundle = readFileSync(outfile, 'utf8')
        expect(bundle, `${subpath.name} bundle`).not.toMatch(/(?:^|[^\w])node:/i)
        const exports = runBrowserBundle(bundle, outfile, globalName)
        await subpath.smoke(exports)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 360_000)
})

function runBrowserBundle(bundle: string, filename: string, globalName: string): Record<string, unknown> {
  const sandbox = {
    AbortController,
    AbortSignal,
    Array,
    ArrayBuffer,
    Boolean,
    Date,
    DataView,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    TextDecoder,
    TextEncoder,
    TypeError,
    Uint8Array,
    URL,
    URLSearchParams,
    atob,
    btoa,
    clearTimeout,
    console,
    crypto: webcrypto,
    fetch,
    globalThis: undefined as unknown,
    setTimeout,
  } as Record<string, unknown>
  sandbox.globalThis = sandbox
  runInNewContext(bundle, sandbox, { filename })
  return sandbox[globalName] as Record<string, unknown>
}

async function smokeWorker(module: Record<string, unknown>): Promise<void> {
  const createAudit = module.createIntegrationAuditEvent as (input: Record<string, unknown>) => Record<string, unknown>
  const audit = createAudit({ type: 'healthcheck.completed', now: () => new Date('2026-01-01T00:00:00.000Z') })
  expect(audit.id).toMatch(/^audit_[0-9a-f-]{36}$/)
  expect(audit.occurredAt).toBe('2026-01-01T00:00:00.000Z')

  const Store = module.InMemoryIntegrationIdempotencyStore as new () => Record<string, unknown>
  const Guard = module.DefaultIntegrationActionGuard as new (options: Record<string, unknown>) => {
    invokeAction(ctx: unknown, proceed: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>>
  }
  const store = new Store()
  const guard = new Guard({ idempotency: store, now: () => new Date('2026-01-01T00:00:00.000Z') })
  const ctx = {
    connection: { id: 'connection_1', owner: { type: 'user', id: 'user_1' }, providerId: 'demo', connectorId: 'demo', status: 'active', grantedScopes: [] },
    request: { connectionId: 'connection_1', action: 'notes.create', input: { title: 'hello' }, idempotencyKey: 'request_1' },
    action: { id: 'notes.create', title: 'Create note', risk: 'write', requiredScopes: [], dataClass: 'private' },
  }
  const first = await guard.invokeAction(ctx, async () => ({ ok: true, action: 'notes.create', output: { created: true } }))
  const replay = await guard.invokeAction(ctx, async () => ({ ok: true, action: 'notes.create', output: { created: false } }))
  expect(first.output).toEqual({ created: true })
  expect(replay.metadata).toMatchObject({ idempotentReplay: true })

  const Policy = module.createDefaultIntegrationPolicyEngine as (options: Record<string, unknown>) => { decide(ctx: unknown): Record<string, unknown> }
  const decision = Policy({ now: () => new Date('2026-01-01T00:00:00.000Z') }).decide({ ...ctx, subject: { type: 'user', id: 'user_1' } })
  expect(decision.decision).toBe('require_approval')
  expect((decision.approval as Record<string, unknown>).id).toMatch(/^approval_[0-9a-f-]{36}$/)
}

async function smokeSpecs(module: Record<string, unknown>): Promise<void> {
  const list = module.listIntegrationSpecs as () => Array<Record<string, unknown>>
  const get = module.getIntegrationSpec as (kind: string) => Record<string, unknown> | undefined
  expect(list().length).toBeGreaterThanOrEqual(140)
  expect(get('gmail')?.kind).toBe('gmail')
  expect(module.INTEGRATION_FAMILIES).toBeDefined()
}

async function smokeCatalog(module: Record<string, unknown>): Promise<void> {
  const name = (module.integrationToolName as (providerId: string, connectorId: string, actionId: string) => string)('provider/é', 'demo_✓', 'read.write')
  expect((module.parseIntegrationToolName as (value: string) => unknown)(name)).toEqual({
    providerId: 'provider/é',
    connectorId: 'demo_✓',
    actionId: 'read.write',
  })
  const tools = (module.buildIntegrationToolCatalog as (connectors: unknown[]) => unknown[])([{
    id: 'demo_✓',
    providerId: 'provider/é',
    title: 'Demo',
    category: 'docs',
    auth: 'none',
    scopes: [],
    actions: [{
      id: 'read.write',
      title: 'Read',
      risk: 'read',
      requiredScopes: [],
      dataClass: 'private',
    }],
  }])
  expect(tools).toHaveLength(1)
  expect((module.toMcpTools as (tools: unknown[]) => Array<Record<string, unknown>>)(tools)[0]?.name).toBe(name)
}
