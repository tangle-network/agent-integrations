import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_PATHS = [
  'README.md',
  'data',
  'docs',
  'examples',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts',
  'src',
  'tsconfig.json',
  'tsup.config.ts',
]

describe('release entry point', () => {
  it('rejects stale manifests even when npm lifecycle scripts are ignored', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'agent-integrations-release-test-'))

    try {
      createFixture(fixtureDirectory)
      const manifestPath = join(fixtureDirectory, 'data/bundled-adapter-manifests.json')
      const manifests = JSON.parse(readFileSync(manifestPath, 'utf8')) as Array<Record<string, unknown>>
      manifests[0] = { ...manifests[0], description: `${String(manifests[0]?.description ?? '')} stale-test` }
      writeFileSync(manifestPath, `${JSON.stringify(manifests)}\n`)

      const result = spawnSync(process.execPath, ['scripts/release.mjs'], {
        cwd: fixtureDirectory,
        env: { ...process.env, npm_config_ignore_scripts: 'true' },
        encoding: 'utf8',
      })
      const output = `${result.stdout}\n${result.stderr}`

      expect(result.status).not.toBe(0)
      expect(output).toMatch(/bundled adapter manifest snapshot is stale/i)
      expect(output).not.toMatch(/Release artifact verified:/)
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  }, 300_000)
})

function createFixture(fixtureDirectory: string): void {
  mkdirSync(fixtureDirectory, { recursive: true })
  for (const relativePath of FIXTURE_PATHS) {
    const sourcePath = join(REPO_ROOT, relativePath)
    const targetPath = join(fixtureDirectory, relativePath)
    mkdirSync(dirname(targetPath), { recursive: true })
    cpSync(sourcePath, targetPath, { recursive: true })
  }
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(fixtureDirectory, 'node_modules'), 'dir')
}
