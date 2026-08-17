import { buildActivepiecesConnectors, listActivepiecesCatalogEntries } from './activepieces-catalog.js'
import { buildTangleIntegrationCatalogConnectors } from './tangle-catalog.js'
import type {
  IntegrationCatalogSource,
  IntegrationConnector,
} from './core-types.js'
import {
  composeIntegrationRegistry,
  type IntegrationRegistry,
  type IntegrationSupportTier,
} from './registry-core.js'
import { integrationSpecToConnector, listIntegrationSpecs } from './specs/registry.js'

export {
  canonicalConnectorId,
  composeIntegrationRegistry,
  inferIntegrationSupportTier,
  summarizeIntegrationRegistry,
} from './registry-core.js'
export type {
  ComposeIntegrationRegistryOptions,
  IntegrationRegistry,
  IntegrationRegistryConflict,
  IntegrationRegistryEntry,
  IntegrationRegistrySourceRef,
  IntegrationRegistrySummary,
  IntegrationSupportTier,
} from './registry-core.js'

export function buildDefaultIntegrationRegistry(options: {
  includeSpecs?: boolean
  includeTangleCatalog?: boolean
  tangleCatalogRuntimeExecutable?: boolean
  /** @deprecated Use includeTangleCatalog. */
  includeActivepieces?: boolean
} = {}): IntegrationRegistry {
  const includeSpecs = options.includeSpecs ?? true
  const includeTangleCatalog = options.includeTangleCatalog ?? options.includeActivepieces ?? true
  const sources: IntegrationCatalogSource[] = []
  if (includeSpecs) {
    sources.push({
      id: 'spec',
      connectors: listIntegrationSpecs().map((spec) => integrationSpecToConnector(spec, 'spec')),
    })
  }
  if (includeTangleCatalog) {
    const tangleConnectors = options.tangleCatalogRuntimeExecutable
      ? buildTangleIntegrationCatalogConnectors({
          providerId: 'tangle-catalog',
          includeCatalogActions: true,
          executable: true,
        })
      : buildActivepiecesConnectors({ providerId: 'tangle-catalog' }).map((connector) => ({
          ...connector,
          providerId: 'tangle-catalog',
          metadata: {
            source: 'tangle-integrations-catalog',
            providerId: 'tangle-catalog',
            executable: connector.metadata?.executable,
            runtime: 'native-adapter-backlog',
            catalogOnly: connector.metadata?.catalogOnly,
            supportTier: connector.metadata?.supportTier,
            catalogActionCount: connector.metadata?.catalogActionCount,
            catalogTriggerCount: connector.metadata?.catalogTriggerCount,
            license: connector.metadata?.license,
            version: connector.metadata?.version,
            domains: Array.isArray(connector.metadata?.domains)
              ? connector.metadata.domains.filter((domain) => typeof domain === 'string' && !domain.toLowerCase().includes('activepieces'))
              : undefined,
            ...(connector.metadata?.overridden ? { overridden: true } : {}),
          },
        }))
    sources.push({
      id: 'tangle-catalog',
      connectors: tangleConnectors,
    })
  }
  return composeIntegrationRegistry(sources)
}

/** Per-entry executability classification. Pure metadata — never loads or
 *  runs a runtime module. The coverage report consumes this to separate
 *  "we can execute this today" from "catalog-only / setup-only". */
export interface IntegrationCatalogExecutability {
  canonicalId: string
  /** True when the entry resolves to a runnable action: a first-party /
   *  sandbox / gateway-executable support tier, or a tangle-catalog entry
   *  with a resolvable npm runtime package. */
  executable: boolean
  supportTier: IntegrationSupportTier
  authKind: IntegrationConnector['auth']
  /** Resolvable npm runtime package name when one is registered for this
   *  connector in the vendored catalog; undefined for first-party adapters
   *  (which execute in-process) and catalog-only entries. */
  runtimePackage?: string
  actionCount: number
  triggerCount: number
}

/** Classify every entry in a composed registry by executability + auth kind
 * WITHOUT executing anything. Defaults to {@link buildDefaultIntegrationRegistry}. */
export function classifyIntegrationCatalogExecutability(
  registry: IntegrationRegistry = buildDefaultIntegrationRegistry(),
): IntegrationCatalogExecutability[] {
  const packageByConnector = new Map(
    listActivepiecesCatalogEntries()
      .filter((entry) => entry.npmPackage)
      .map((entry) => [entry.id, entry.npmPackage!]),
  )
  return registry.entries.map((entry) => {
    const runtimePackage = packageByConnector.get(entry.connector.id)
    const tierExecutable =
      entry.supportTier === 'firstPartyExecutable' ||
      entry.supportTier === 'sandboxExecutable' ||
      entry.supportTier === 'gatewayExecutable'
    return {
      canonicalId: entry.canonicalId,
      executable: tierExecutable && entry.connector.actions.length > 0,
      supportTier: entry.supportTier,
      authKind: entry.connector.auth,
      runtimePackage,
      actionCount: entry.connector.actions.length,
      triggerCount: entry.connector.triggers?.length ?? 0,
    }
  })
}
