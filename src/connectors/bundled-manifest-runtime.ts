import type { ConnectorAdapter, ConnectorManifest } from './types.js'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  type ConnectorAdapterFactoryDefinition,
} from './adapters/factories.js'
import * as bundledAdapters from './adapters/index.js'

const MANIFEST_PROBE_PREFIX = 'tangle-adapter-metadata-'

function isConnectorAdapter(value: unknown): value is ConnectorAdapter {
  if (!value || typeof value !== 'object') return false
  const manifest = (value as { manifest?: unknown }).manifest
  if (!manifest || typeof manifest !== 'object') return false
  return typeof (manifest as { kind?: unknown }).kind === 'string'
}

function manifestFromFactory(
  definition: ConnectorAdapterFactoryDefinition,
): ConnectorManifest | undefined {
  const probeOptions = Object.fromEntries(
    Object.keys(definition.envMap).map((name) => [name, `${MANIFEST_PROBE_PREFIX}${name}`]),
  )
  try {
    return definition.factory(probeOptions).manifest
  } catch {
    return undefined
  }
}

/**
 * Direct adapter instances that public catalog and action hosts may register.
 *
 * Factory adapters are intentionally absent: their construction requires
 * product-owned OAuth configuration. Inbound-only adapters remain available
 * as named exports for webhook hosts, but never compete with action adapters
 * for a public connector kind.
 */
export function listBundledConnectorAdapters(): ConnectorAdapter[] {
  const byKind = new Map<string, ConnectorAdapter>()
  const exportByKind = new Map<string, string>()
  for (const [exportName, value] of Object.entries(bundledAdapters)) {
    if (!isConnectorAdapter(value) || value.inboundOnly) continue
    const kind = value.manifest.kind
    const existingExport = exportByKind.get(kind)
    if (existingExport) {
      throw new Error(
        `Duplicate public connector adapter kind "${kind}" exported by "${existingExport}" and "${exportName}".`,
      )
    }
    exportByKind.set(kind, exportName)
    byKind.set(kind, value)
  }
  return [...byKind.values()]
}

/** Build the runtime manifest registry used to regenerate the static snapshot. */
export function buildRuntimeBundledAdapterManifests(): ConnectorManifest[] {
  const byKind = new Map<string, ConnectorManifest>()
  for (const adapter of listBundledConnectorAdapters()) {
    byKind.set(adapter.manifest.kind, adapter.manifest)
  }
  for (const definition of CONNECTOR_ADAPTER_FACTORIES) {
    if (byKind.has(definition.kind)) continue
    const manifest = manifestFromFactory(definition)
    if (manifest) byKind.set(manifest.kind, manifest)
  }
  return [...byKind.values()]
}
