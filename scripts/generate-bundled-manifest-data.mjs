import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeBundledAdapterManifests } from './bundled-manifest-snapshot.mjs'

const { buildRuntimeBundledAdapterManifests } = await import('../dist/internal/bundled-manifest-runtime.js')
const manifests = buildRuntimeBundledAdapterManifests()
const encoded = encodeBundledAdapterManifests(manifests)
const outputPath = resolve(
  process.cwd(),
  getOption('--output') ?? fileURLToPath(new URL('../data/bundled-adapter-manifests.json', import.meta.url)),
)

writeFileSync(outputPath, encoded)
console.log(`Wrote ${manifests.length} bundled adapter manifests to ${outputPath}.`)

function getOption(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  return value
}
