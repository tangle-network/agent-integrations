import { writeFileSync } from 'node:fs'

const undefinedMarker = { __tangleUndefined: true }
const { buildRuntimeBundledAdapterManifests } = await import('../dist/internal/bundled-manifest-runtime.js')
const manifests = buildRuntimeBundledAdapterManifests().sort((a, b) => a.kind.localeCompare(b.kind))

const encoded = JSON.stringify(
  manifests,
  (_key, value) => value === undefined ? undefinedMarker : value,
)

if (encoded.includes('"__tangleUndefined"')) {
  const markerCount = (encoded.match(/"__tangleUndefined"/g) ?? []).length
  if (markerCount !== manifests.reduce((count, manifest) => count + countUndefined(manifest), 0)) {
    throw new Error('Bundled manifest undefined-value encoding count is inconsistent.')
  }
}

writeFileSync(new URL('../data/bundled-adapter-manifests.json', import.meta.url), `${encoded}\n`)
console.log(`Wrote ${manifests.length} bundled adapter manifests.`)

function countUndefined(value) {
  if (value === undefined) return 1
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value)) return value.reduce((count, item) => count + countUndefined(item), 0)
  return Object.values(value).reduce((count, item) => count + countUndefined(item), 0)
}
