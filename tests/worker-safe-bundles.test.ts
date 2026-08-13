import { readdirSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'tsup'
import { describe, expect, it } from 'vitest'

const FORBIDDEN_WORKER_GRAPH = /read-excel-file|write-excel-file|graceful-fs|@duckdb\/node-api|@duckdb\/node-bindings|ssh2-sftp-client|cpu-features/i

const SUBPATHS = [
  {
    name: 'worker',
    entry: 'src/worker.ts',
    smoke: async (outDir: string) => {
      const module = await import(pathToFileURL(join(outDir, 'worker.js')).href)
      expect(module.createDefaultIntegrationActionGuard).toEqual(expect.any(Function))
      expect(module.createIntegrationAuditEvent).toEqual(expect.any(Function))
      expect(module.createDefaultIntegrationPolicyEngine).toEqual(expect.any(Function))
      expect(module.createIntegrationAuditEvent({ type: 'healthcheck.completed' }).type).toBe('healthcheck.completed')
    },
  },
  {
    name: 'specs',
    entry: 'src/specs/index.ts',
    smoke: async (outDir: string) => {
      const module = await import(pathToFileURL(join(outDir, 'specs.js')).href)
      const specs = module.listIntegrationSpecs()
      expect(specs.length).toBeGreaterThanOrEqual(140)
      expect(module.getIntegrationSpec('gmail')?.kind).toBe('gmail')
      expect(module.INTEGRATION_FAMILIES).toBeDefined()
    },
  },
  {
    name: 'catalog',
    entry: 'src/catalog.ts',
    smoke: async (outDir: string) => {
      const module = await import(pathToFileURL(join(outDir, 'catalog.js')).href)
      const name = module.integrationToolName('test', 'demo', 'read')
      expect(module.parseIntegrationToolName(name)).toEqual({
        providerId: 'test',
        connectorId: 'demo',
        actionId: 'read',
      })
      const tools = module.buildIntegrationToolCatalog([{
        id: 'demo',
        providerId: 'test',
        title: 'Demo',
        category: 'docs',
        auth: 'none',
        scopes: [],
        actions: [{
          id: 'read',
          title: 'Read',
          risk: 'read',
          requiredScopes: [],
          dataClass: 'private',
        }],
      }])
      expect(tools).toHaveLength(1)
      expect(module.toMcpTools(tools)[0]?.name).toBe(name)
    },
  },
] as const

describe.sequential('Worker-safe package subpaths', () => {
  for (const subpath of SUBPATHS) {
    it(`keeps /${subpath.name} free of Node-only adapter dependencies in every emitted chunk`, async () => {
      const outDir = mkdtempSync(join(tmpdir(), `agent-integrations-${subpath.name}-`))
      try {
        await build({
          entry: { [subpath.name]: subpath.entry },
          outDir,
          format: ['esm'],
          dts: false,
          sourcemap: false,
          clean: true,
          target: 'es2022',
          external: ['node:*'],
        })

        const javascriptFiles = collectJavaScriptFiles(outDir)
        expect(javascriptFiles.length).toBeGreaterThan(0)
        for (const file of javascriptFiles) {
          expect(readFileSync(file, 'utf8'), relative(outDir, file)).not.toMatch(FORBIDDEN_WORKER_GRAPH)
        }
        await subpath.smoke(outDir)
      } finally {
        rmSync(outDir, { recursive: true, force: true })
      }
    })
  }
})

function collectJavaScriptFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(path))
    else if (entry.isFile() && path.endsWith('.js')) files.push(path)
  }
  return files
}
