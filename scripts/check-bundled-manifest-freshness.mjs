import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { assertBundledManifestSnapshotFresh } from './bundled-manifest-snapshot.mjs'

const dataFile = resolve(process.cwd(), getOption('--data-file') ?? 'data/bundled-adapter-manifests.json')
const runtimeFile = resolve(process.cwd(), getOption('--runtime-file') ?? 'dist/internal/bundled-manifest-runtime.js')

export async function checkBundledManifestFreshness({
  dataPath = dataFile,
  runtimePath = runtimeFile,
} = {}) {
  const [{ buildRuntimeBundledAdapterManifests }, snapshot] = await Promise.all([
    import(pathToFileURL(runtimePath).href),
    readFile(dataPath, 'utf8'),
  ])
  return assertBundledManifestSnapshotFresh({
    snapshot,
    manifests: buildRuntimeBundledAdapterManifests(),
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkBundledManifestFreshness()
  console.log(`Bundled adapter manifest snapshot is fresh (${result.manifestCount} manifests).`)
}

function getOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
