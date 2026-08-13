import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = join(rootDirectory, 'package.json')
const packageDataPath = join(rootDirectory, 'data/bundled-adapter-manifests.json')
const registry = 'https://registry.npmjs.org'
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const publish = parseArguments(process.argv.slice(2))
const packageData = JSON.parse(readFileSync(packagePath, 'utf8'))
const releaseDirectory = mkdtempSync(join(tmpdir(), 'agent-integrations-release-'))
const generatedManifestPath = join(releaseDirectory, 'bundled-adapter-manifests.json')
const archiveDirectory = join(releaseDirectory, 'archive')
mkdirSync(archiveDirectory)

try {
  run(pnpmCommand, ['run', 'build'])

  run(process.execPath, [
    'scripts/generate-bundled-manifest-data.mjs',
    '--output',
    generatedManifestPath,
  ])

  assertCommittedManifestIsFresh(generatedManifestPath)
  run(process.execPath, ['scripts/check-bundled-manifest-freshness.mjs'])

  run(pnpmCommand, [
    'pack',
    '--pack-destination',
    archiveDirectory,
    '--silent',
  ], { npm_config_ignore_scripts: 'true' })

  const archivePath = getSingleArchivePath(archiveDirectory)
  run(process.execPath, ['scripts/test-release-artifact.mjs', archivePath])

  if (publish) publishArtifact(archivePath, packageData)
  else console.log(`Release artifact ready: ${archivePath}`)
} catch (error) {
  console.error(`[release] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  rmSync(releaseDirectory, { recursive: true, force: true })
}

function parseArguments(args) {
  if (args[0] === '--') args = args.slice(1)
  const unknown = args.filter((arg) => arg !== '--publish')
  if (unknown.length > 0) throw new Error(`Unknown release option: ${unknown.join(', ')}`)
  return args.includes('--publish')
}

function run(command, args, environment = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}.`)
  }
}

function assertCommittedManifestIsFresh(generatedPath) {
  const generated = readFileSync(generatedPath, 'utf8')
  const committed = readFileSync(packageDataPath, 'utf8')
  if (generated !== committed) {
    throw new Error(
      'Bundled adapter manifest snapshot is stale. '
      + 'Run pnpm run generate:bundled-manifests before releasing.',
    )
  }
}

function getSingleArchivePath(directory) {
  const archives = readdirSync(directory)
    .filter((entry) => entry.endsWith('.tgz'))
    .map((entry) => join(directory, entry))
  if (archives.length !== 1) {
    throw new Error(`Expected exactly one release archive, found ${archives.length}.`)
  }
  return archives[0]
}

function publishArtifact(archivePath, packageData) {
  const version = `${packageData.name}@${packageData.version}`
  const archiveIntegrity = getArchiveIntegrity(archivePath)
  const existing = spawnSync(npmCommand, ['view', version, 'dist.integrity', '--registry', registry], {
    cwd: rootDirectory,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (existing.error) throw existing.error
  if (existing.status === 0) {
    const registryIntegrity = existing.stdout.trim()
    if (registryIntegrity !== archiveIntegrity) {
      throw new Error(
        `${version} already exists with integrity ${registryIntegrity || 'missing'}; `
        + `release archive has ${archiveIntegrity}.`,
      )
    }
    console.log(`${version} already exists with matching integrity; skipping publish.`)
    return
  }

  run(npmCommand, [
    'publish',
    archivePath,
    '--access',
    'public',
    '--ignore-scripts',
    '--provenance',
    '--registry',
    registry,
  ], { npm_config_ignore_scripts: 'true' })
}

function getArchiveIntegrity(archivePath) {
  return `sha512-${createHash('sha512').update(readFileSync(archivePath)).digest('base64')}`
}
