import {
  buildActivepiecesConnectors,
  listActivepiecesCatalogEntries,
  type ActivepiecesCatalogEntry,
} from './activepieces-catalog.js'
import {
  auditIntegrationCatalogFreshness,
  extractActivepiecesPublicPieceCount,
  type IntegrationCatalogFreshnessOptions,
} from './catalog-freshness.js'
import {
  IntegrationError,
  type CompleteAuthRequest,
  type IntegrationActionRequest,
  type IntegrationActionResult,
  type IntegrationConnection,
  type IntegrationConnector,
  type IntegrationTriggerEvent,
  type IntegrationTriggerSubscription,
  type StartAuthRequest,
  type StartAuthResult,
} from './index.js'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  listBundledConnectorAdapters,
} from './connectors/index.js'
import { canonicalIntegrationKind } from './integration-kind-aliases.js'

export {
  type ActivepiecesCatalogEntry,
} from './activepieces-catalog.js'

export const TANGLE_INTEGRATIONS_CATALOG_PROVIDER_ID = 'tangle-catalog'
export const TANGLE_INTEGRATIONS_CATALOG_SOURCE = 'tangle-integrations-catalog'

export type TangleIntegrationImplementationKind = 'native_adapter' | 'package_runtime'
export type TangleIntegrationContractStatus = 'contract_ready' | 'runtime_backed' | 'native_backed'

export interface TangleIntegrationContract {
  id: string
  title: string
  description: string
  category: IntegrationConnector['category']
  auth: IntegrationConnector['auth']
  authFields: NonNullable<ActivepiecesCatalogEntry['authFields']>
  actions: Array<{
    id: string
    title: string
    risk: IntegrationConnector['actions'][number]['risk']
    upstreamName: string
  }>
  triggers: Array<{
    id: string
    title: string
    upstreamName: string
  }>
  implementation: {
    kind: TangleIntegrationImplementationKind
    runtimePackage?: string
    version?: string
  }
  status: TangleIntegrationContractStatus
  quality: {
    tangleContract: true
    authFieldsMapped: boolean
    actionNamesMapped: boolean
    triggerNamesMapped: boolean
    runtimePackageMapped: boolean
    nativeAdapter: boolean
  }
}

export interface TangleCatalogRuntimePackageManifestOptions {
  name?: string
  includeAgentIntegrationsPackage?: boolean
  agentIntegrationsVersion?: string
  additionalDependencies?: Record<string, string>
}

export interface TangleCatalogRuntimePackageManifest {
  name: string
  private: true
  type: 'module'
  dependencies: Record<string, string>
  tangle: {
    integrationContracts: number
    packageRuntimeBackends: number
    generatedFrom: typeof TANGLE_INTEGRATIONS_CATALOG_SOURCE
  }
}
export type TangleIntegrationCatalogFreshnessOptions = IntegrationCatalogFreshnessOptions

export interface TangleIntegrationCatalogFreshnessResult {
  ok: boolean
  generatedAt: string
  local: {
    catalogEntries: number
    catalogConnectors: number
    catalogActions: number
    catalogTriggers: number
    executableCatalogConnectors: number
    executableCatalogActions: number
    executableCatalogTriggers: number
    executableToolDefinitions: number
    unsupportedExecutableConnectorIds: string[]
    registryEntries: number
    registrySummary: Awaited<ReturnType<typeof auditIntegrationCatalogFreshness>>['local']['registrySummary']
    conflictSamples: Awaited<ReturnType<typeof auditIntegrationCatalogFreshness>>['local']['conflictSamples']
  }
  upstream?: {
    externalEntries?: number
    externalDelta?: number
    checkedUrl: string
    warning?: string
  }
  warnings: string[]
}

export function listTangleNativeAdapterIds(): string[] {
  const ids = new Set<string>(
    CONNECTOR_ADAPTER_FACTORIES.map(
      (definition) => definition.kind,
    ),
  )
  for (const adapter of listBundledConnectorAdapters()) {
    ids.add(adapter.manifest.kind)
  }
  return [...ids].sort()
}

export function listTangleIntegrationContracts(): TangleIntegrationContract[] {
  const nativeAdapterIds = new Set(listTangleNativeAdapterIds().map(canonicalIntegrationKind))
  return listActivepiecesCatalogEntries().map((entry) => {
    const nativeAdapter = nativeAdapterIds.has(canonicalIntegrationKind(entry.id))
    return {
      id: entry.id,
      title: entry.title,
      description: entry.description,
      category: entry.category,
      auth: entry.auth,
      authFields: entry.authFields ?? [],
      actions: entry.actions.map((action) => ({
        id: action.id,
        title: action.title,
        risk: action.risk,
        upstreamName: action.upstreamName ?? action.id,
      })),
      triggers: entry.triggers.map((trigger) => ({
        id: trigger.id,
        title: trigger.title,
        upstreamName: trigger.upstreamName ?? trigger.id,
      })),
      implementation: {
        kind: nativeAdapter ? 'native_adapter' : 'package_runtime',
        runtimePackage: entry.npmPackage,
        version: entry.version,
      },
      status: nativeAdapter ? 'native_backed' : entry.npmPackage ? 'runtime_backed' : 'contract_ready',
      quality: {
        tangleContract: true,
        authFieldsMapped: entry.auth === 'none' || Boolean(entry.authFields?.length),
        actionNamesMapped: entry.actions.every((action) => Boolean(action.upstreamName)),
        triggerNamesMapped: entry.triggers.every((trigger) => Boolean(trigger.upstreamName)),
        runtimePackageMapped: Boolean(entry.npmPackage),
        nativeAdapter,
      },
    }
  })
}

export function listTangleIntegrationCatalogRuntimePackages(): Array<{
  connectorId: string
  packageName: string
  version?: string
}> {
  const nativeAdapterIds = new Set(listTangleNativeAdapterIds())
  return listActivepiecesCatalogEntries()
    .filter((entry): entry is ActivepiecesCatalogEntry & { npmPackage: string } =>
      Boolean(entry.npmPackage) && !nativeAdapterIds.has(entry.id))
    .map((entry) => ({
      connectorId: entry.id,
      packageName: entry.npmPackage,
      version: entry.version,
    }))
}

export function buildTangleCatalogRuntimePackageManifest(
  options: TangleCatalogRuntimePackageManifestOptions = {},
): TangleCatalogRuntimePackageManifest {
  const dependencies: Record<string, string> = {}
  if (options.includeAgentIntegrationsPackage ?? true) {
    dependencies['@tangle-network/agent-integrations'] = options.agentIntegrationsVersion ?? 'latest'
  }
  for (const pkg of listTangleIntegrationCatalogRuntimePackages()) {
    dependencies[pkg.packageName] = pkg.version ?? 'latest'
  }
  Object.assign(dependencies, options.additionalDependencies)
  return {
    name: options.name ?? '@tangle-network/agent-integrations-runtime-bundle',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
    tangle: {
      integrationContracts: listTangleIntegrationContracts().length,
      packageRuntimeBackends: listTangleIntegrationContracts()
        .filter((contract) => contract.implementation.kind === 'package_runtime').length,
      generatedFrom: TANGLE_INTEGRATIONS_CATALOG_SOURCE,
    },
  }
}

export function buildTangleIntegrationCatalogConnectors(options: {
  providerId?: string
  includeCatalogActions?: boolean
  executable?: boolean
} = {}): IntegrationConnector[] {
  const providerId = options.providerId ?? TANGLE_INTEGRATIONS_CATALOG_PROVIDER_ID
  return buildActivepiecesConnectors({
    ...options,
    providerId,
  }).map((connector) => sanitizeConnector(connector, providerId))
}

export const extractExternalCatalogPublicCount = extractActivepiecesPublicPieceCount

export async function auditTangleIntegrationCatalogFreshness(
  options: TangleIntegrationCatalogFreshnessOptions = {},
): Promise<TangleIntegrationCatalogFreshnessResult> {
  const result = await auditIntegrationCatalogFreshness(options)
  return {
    ok: result.ok,
    generatedAt: result.generatedAt,
    local: {
      catalogEntries: result.local.activepiecesEntries,
      catalogConnectors: result.local.activepiecesConnectors,
      catalogActions: result.local.activepiecesActions,
      catalogTriggers: result.local.activepiecesTriggers,
      executableCatalogConnectors: result.local.executableActivepiecesConnectors,
      executableCatalogActions: result.local.executableActivepiecesActions,
      executableCatalogTriggers: result.local.executableActivepiecesTriggers,
      executableToolDefinitions: result.local.executableToolDefinitions,
      unsupportedExecutableConnectorIds: result.local.unsupportedExecutableConnectorIds,
      registryEntries: result.local.registryEntries,
      registrySummary: result.local.registrySummary,
      conflictSamples: result.local.conflictSamples,
    },
    upstream: result.upstream
      ? {
          externalEntries: result.upstream.activepiecesPieces,
          externalDelta: result.upstream.activepiecesDelta,
          checkedUrl: result.upstream.checkedUrl,
          warning: result.upstream.warning,
        }
      : undefined,
    warnings: result.warnings.map((warning) => warning.replaceAll('Activepieces', 'Tangle Integrations Catalog')),
  }
}

function sanitizeConnector(connector: IntegrationConnector, providerId: string): IntegrationConnector {
  const metadata = connector.metadata ?? {}
  return {
    ...connector,
    providerId,
    metadata: {
      source: TANGLE_INTEGRATIONS_CATALOG_SOURCE,
      providerId,
      executable: metadata.executable,
      runtime: 'native-adapter-backlog',
      catalogOnly: metadata.catalogOnly,
      supportTier: metadata.supportTier,
      catalogActionCount: metadata.catalogActionCount,
      catalogTriggerCount: metadata.catalogTriggerCount,
      license: metadata.license,
      version: metadata.version,
      domains: Array.isArray(metadata.domains)
        ? metadata.domains.filter((domain) => typeof domain === 'string' && !domain.toLowerCase().includes('activepieces'))
        : undefined,
      ...(metadata.overridden ? { overridden: true } : {}),
    },
  }
}
