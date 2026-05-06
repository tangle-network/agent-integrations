import {
  buildActivepiecesConnectors,
  listActivepiecesCatalogEntries,
} from './activepieces-catalog.js'
import { createActivepiecesExecutorProvider } from './activepieces-provider.js'
import { buildIntegrationToolCatalog } from './catalog.js'
import {
  buildDefaultIntegrationRegistry,
  composeIntegrationRegistry,
  type IntegrationRegistryConflict,
  type IntegrationRegistrySummary,
  summarizeIntegrationRegistry,
} from './registry.js'

export interface IntegrationCatalogFreshnessOptions {
  liveActivepieces?: boolean
  minActivepiecesConnectors?: number
  staleConnectorDelta?: number
  fetchImpl?: typeof fetch
}

export interface IntegrationCatalogFreshnessResult {
  ok: boolean
  generatedAt: string
  local: {
    activepiecesEntries: number
    activepiecesConnectors: number
    activepiecesActions: number
    activepiecesTriggers: number
    executableActivepiecesConnectors: number
    executableActivepiecesActions: number
    executableActivepiecesTriggers: number
    executableToolDefinitions: number
    unsupportedExecutableConnectorIds: string[]
    registryEntries: number
    registrySummary: IntegrationRegistrySummary
    conflictSamples: IntegrationRegistryConflict[]
  }
  upstream?: {
    activepiecesPieces?: number
    activepiecesDelta?: number
    checkedUrl: string
    warning?: string
  }
  warnings: string[]
}

export const ACTIVEPIECES_PUBLIC_CATALOG_URL = 'https://www.activepieces.com/pieces'

function parseCount(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value.replace(/,/g, ''), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function extractActivepiecesPublicPieceCount(html: string): number | undefined {
  const showingMatch = html.match(/Showing\s+([0-9,]+)\s+pieces/i)
  const integrationMatch = html.match(/([0-9,]+)\+?\s+Integrations/i)
  return parseCount(showingMatch?.[1]) ?? parseCount(integrationMatch?.[1])
}

export async function auditIntegrationCatalogFreshness(
  options: IntegrationCatalogFreshnessOptions = {},
): Promise<IntegrationCatalogFreshnessResult> {
  const minActivepiecesConnectors = options.minActivepiecesConnectors ?? 600
  const staleConnectorDelta = options.staleConnectorDelta ?? 25
  const activepiecesEntries = listActivepiecesCatalogEntries()
  const activepiecesConnectors = buildActivepiecesConnectors({
    includeCatalogActions: true,
  })
  const executableActivepiecesProvider = createActivepiecesExecutorProvider({
    executeAction: () => ({ ok: true, action: 'audit.noop' }),
  })
  const executableActivepiecesConnectors = await executableActivepiecesProvider.listConnectors()
  const executableRegistry = composeIntegrationRegistry([
    {
      id: executableActivepiecesProvider.id,
      connectors: executableActivepiecesConnectors,
    },
  ])
  const executableTools = buildIntegrationToolCatalog(executableRegistry.connectors)
  const unsupportedExecutableConnectorIds = executableActivepiecesConnectors
    .filter((connector) => connector.actions.length === 0)
    .map((connector) => connector.id)
  const registry = buildDefaultIntegrationRegistry({
    includeSpecs: true,
    includeActivepieces: true,
  })
  const warnings: string[] = []

  if (activepiecesConnectors.length < minActivepiecesConnectors) {
    warnings.push(
      `Activepieces catalog has ${activepiecesConnectors.length} connectors, below floor ${minActivepiecesConnectors}.`,
    )
  }
  if (unsupportedExecutableConnectorIds.length > 0) {
    warnings.push(
      `Activepieces executable provider has ${unsupportedExecutableConnectorIds.length} connectors without actions.`,
    )
  }
  if (executableTools.length < activepiecesEntries.length) {
    warnings.push(
      `Activepieces executable provider produced only ${executableTools.length} tool definitions for ${activepiecesEntries.length} entries.`,
    )
  }

  let upstream: IntegrationCatalogFreshnessResult['upstream']
  if (options.liveActivepieces) {
    upstream = await checkActivepiecesPublicCatalog({
      localConnectorCount: activepiecesConnectors.length,
      staleConnectorDelta,
      fetchImpl: options.fetchImpl,
      warnings,
    })
  }

  return {
    ok: warnings.length === 0,
    generatedAt: new Date().toISOString(),
    local: {
      activepiecesEntries: activepiecesEntries.length,
      activepiecesConnectors: activepiecesConnectors.length,
      activepiecesActions: activepiecesConnectors.reduce(
        (sum, connector) => sum + connector.actions.length,
        0,
      ),
      activepiecesTriggers: activepiecesConnectors.reduce(
        (sum, connector) => sum + (connector.triggers?.length ?? 0),
        0,
      ),
      executableActivepiecesConnectors: executableActivepiecesConnectors.length,
      executableActivepiecesActions: executableActivepiecesConnectors.reduce(
        (sum, connector) => sum + connector.actions.length,
        0,
      ),
      executableActivepiecesTriggers: executableActivepiecesConnectors.reduce(
        (sum, connector) => sum + (connector.triggers?.length ?? 0),
        0,
      ),
      executableToolDefinitions: executableTools.length,
      unsupportedExecutableConnectorIds,
      registryEntries: registry.entries.length,
      registrySummary: summarizeIntegrationRegistry(registry),
      conflictSamples: registry.entries
        .flatMap((entry) => entry.conflicts)
        .slice(0, 10),
    },
    upstream,
    warnings,
  }
}

async function checkActivepiecesPublicCatalog(input: {
  localConnectorCount: number
  staleConnectorDelta: number
  fetchImpl?: typeof fetch
  warnings: string[]
}): Promise<IntegrationCatalogFreshnessResult['upstream']> {
  try {
    const res = await (input.fetchImpl ?? fetch)(ACTIVEPIECES_PUBLIC_CATALOG_URL, {
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const warning = `Activepieces freshness request failed with HTTP ${res.status}.`
      input.warnings.push(warning)
      return {
        checkedUrl: ACTIVEPIECES_PUBLIC_CATALOG_URL,
        warning,
      }
    }
    const activepiecesPieces = extractActivepiecesPublicPieceCount(await res.text())
    const activepiecesDelta =
      activepiecesPieces === undefined
        ? undefined
        : activepiecesPieces - input.localConnectorCount
    if (
      activepiecesDelta !== undefined &&
      activepiecesDelta > input.staleConnectorDelta
    ) {
      input.warnings.push(
        `Activepieces upstream appears ${activepiecesDelta} connectors ahead of the vendored package catalog.`,
      )
    }
    return {
      activepiecesPieces,
      activepiecesDelta,
      checkedUrl: ACTIVEPIECES_PUBLIC_CATALOG_URL,
      warning:
        activepiecesPieces === undefined
          ? 'Could not parse upstream piece count.'
          : undefined,
    }
  } catch (error) {
    const warning =
      error instanceof Error
        ? error.message
        : 'Activepieces freshness request failed.'
    input.warnings.push(warning)
    return {
      checkedUrl: ACTIVEPIECES_PUBLIC_CATALOG_URL,
      warning,
    }
  }
}
