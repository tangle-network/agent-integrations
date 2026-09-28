import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const archivePath = process.argv[2]

if (!archivePath) throw new Error('Usage: node scripts/test-release-artifact.mjs <package.tgz>')

const rootEntries = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)

if (rootEntries.length === 0 || rootEntries.some((entry) => !entry.startsWith('package/'))) {
  throw new Error('Release artifact contains an unexpected archive path.')
}

const unpackDirectory = mkdtempSync(join(tmpdir(), 'agent-integrations-release-artifact-'))

try {
  execFileSync('tar', ['-xzf', archivePath, '-C', unpackDirectory], { stdio: 'inherit' })
  symlinkSync(join(rootDirectory, 'node_modules'), join(unpackDirectory, 'node_modules'), 'dir')
  const packageDirectory = join(unpackDirectory, 'package')
  const expectedPackage = JSON.parse(readFileSync(join(rootDirectory, 'package.json'), 'utf8'))
  const actualPackage = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))

  if (actualPackage.name !== expectedPackage.name || actualPackage.version !== expectedPackage.version) {
    throw new Error(
      `Release artifact metadata mismatch: expected ${expectedPackage.name}@${expectedPackage.version}, `
      + `received ${actualPackage.name}@${actualPackage.version}.`,
    )
  }
  if (JSON.stringify(actualPackage.exports) !== JSON.stringify(expectedPackage.exports)) {
    throw new Error('Release artifact public exports do not match the source package.')
  }

  for (const exportPath of new Set(collectExportPaths(actualPackage.exports))) {
    if (!exportPath.startsWith('./')) throw new Error(`Package export is not relative: ${exportPath}`)
    const filePath = join(packageDirectory, exportPath.slice(2))
    if (!existsSync(filePath)) {
      throw new Error(`Package export target is missing from the artifact: ${exportPath}`)
    }
  }

  const oauthModulePath = join(packageDirectory, 'dist/connectors/oauth.js')
  const oauthModule = readFileSync(oauthModulePath, 'utf8')
  if (/graceful-fs|read-excel-file|unzipper-esm|connectors\/index/.test(oauthModule)) {
    throw new Error('OAuth-only release entrypoint includes the concrete connector catalog.')
  }
  const oauthConsumerPath = join(packageDirectory, '.release-artifact-oauth-consumer.mjs')
  await import('node:fs/promises').then(({ writeFile }) => writeFile(
    oauthConsumerPath,
    `import * as oauth from '@tangle-network/agent-integrations/connectors/oauth'\n`
      + `const values = new Map()\n`
      + `const store = { async get(key) { return values.get(key) ?? null }, async put(key, value) { values.set(key, value) }, async delete(key) { values.delete(key) } }\n`
      + `const flow = await oauth.startOAuthFlow({ provider: 'google', authorizationUrl: 'https://accounts.example.test/authorize', clientId: 'client', redirectUri: 'https://example.test/callback', scopes: [], store })\n`
      + `const pending = values.get(flow.state)\n`
      + `if (!flow.authorizationUrl.includes('code_challenge_method=S256') || !pending.codeVerifier) throw new Error('OAuth package consumer proof failed')\n`,
  ))
  await import(pathToFileURL(oauthConsumerPath).href)

  const { checkBundledManifestFreshness } = await import(
    pathToFileURL(join(rootDirectory, 'scripts/check-bundled-manifest-freshness.mjs')).href,
  )
  const freshness = await checkBundledManifestFreshness({
    dataPath: join(packageDirectory, 'data/bundled-adapter-manifests.json'),
    runtimePath: join(packageDirectory, 'dist/internal/bundled-manifest-runtime.js'),
  })

  const workerModule = await import(pathToFileURL(join(packageDirectory, 'dist/worker.js')).href)
  if (typeof workerModule.createIntegrationAuditEvent !== 'function') {
    throw new Error('Release artifact worker entry point did not load.')
  }

  console.log(
    `Release artifact verified: ${actualPackage.name}@${actualPackage.version} `
    + `(${freshness.manifestCount} manifests).`,
  )
} finally {
  rmSync(unpackDirectory, { recursive: true, force: true })
}

function collectExportPaths(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(collectExportPaths)
}
