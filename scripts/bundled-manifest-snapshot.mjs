const undefinedMarker = { __tangleUndefined: true }

export function encodeBundledAdapterManifests(manifests) {
  const sortedManifests = [...manifests].sort((a, b) => a.kind.localeCompare(b.kind))
  const encoded = JSON.stringify(
    sortedManifests,
    (_key, value) => value === undefined ? undefinedMarker : value,
  )

  if (encoded.includes('"__tangleUndefined"')) {
    const markerCount = (encoded.match(/"__tangleUndefined"/g) ?? []).length
    if (markerCount !== sortedManifests.reduce((count, manifest) => count + countUndefined(manifest), 0)) {
      throw new Error('Bundled manifest undefined-value encoding count is inconsistent.')
    }
  }

  return `${encoded}\n`
}

export function assertBundledManifestSnapshotFresh({ snapshot, manifests }) {
  try {
    JSON.parse(snapshot)
  } catch (error) {
    throw new Error(
      `Bundled adapter manifest snapshot is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const expected = encodeBundledAdapterManifests(manifests)
  if (snapshot !== expected) {
    throw new Error(
      'Bundled adapter manifest snapshot is stale. Run pnpm run generate:bundled-manifests before packaging.',
    )
  }

  return { manifestCount: manifests.length }
}

function countUndefined(value) {
  if (value === undefined) return 1
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value)) return value.reduce((count, item) => count + countUndefined(item), 0)
  return Object.values(value).reduce((count, item) => count + countUndefined(item), 0)
}
