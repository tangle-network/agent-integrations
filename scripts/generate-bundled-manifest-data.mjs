import { writeFileSync } from 'node:fs'
import { encodeBundledAdapterManifests } from './bundled-manifest-snapshot.mjs'

const { buildRuntimeBundledAdapterManifests } = await import('../dist/internal/bundled-manifest-runtime.js')
const manifests = buildRuntimeBundledAdapterManifests()
const encoded = encodeBundledAdapterManifests(manifests)

writeFileSync(new URL('../data/bundled-adapter-manifests.json', import.meta.url), encoded)
console.log(`Wrote ${manifests.length} bundled adapter manifests.`)
