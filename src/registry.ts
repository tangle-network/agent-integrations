import { buildActivepiecesConnectors, listActivepiecesCatalogEntries } from './activepieces-catalog.js'
import { buildTangleIntegrationCatalogConnectors } from './tangle-catalog.js'
import type {
  IntegrationCatalogSource,
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorTrigger,
} from './core-types.js'
import { integrationSpecToConnector, listIntegrationSpecs } from './specs/registry.js'

export type IntegrationSupportTier =
  | 'catalogOnly'
  | 'setupReady'
  | 'gatewayExecutable'
  | 'firstPartyExecutable'
  | 'sandboxExecutable'

export interface IntegrationRegistrySourceRef {
  sourceId: string
  providerId: string
  connectorId: string
  supportTier: IntegrationSupportTier
  actionCount: number
  triggerCount: number
}

export interface IntegrationRegistryConflict {
  field: 'auth' | 'category'
  values: Array<{
    value: string
    sourceId: string
    connectorId: string
  }>
}

export interface IntegrationRegistryEntry {
  canonicalId: string
  connector: IntegrationConnector
  aliases: string[]
  supportTier: IntegrationSupportTier
  sources: IntegrationRegistrySourceRef[]
  conflicts: IntegrationRegistryConflict[]
}

export interface IntegrationRegistry {
  entries: IntegrationRegistryEntry[]
  connectors: IntegrationConnector[]
  byId: Map<string, IntegrationRegistryEntry>
}

export interface IntegrationRegistrySummary {
  totalEntries: number
  totalSources: number
  toolBindableEntries: number
  conflictEntries: number
  bySupportTier: Record<IntegrationSupportTier, number>
}

export interface ComposeIntegrationRegistryOptions {
  aliases?: Record<string, string>
  sourcePrecedence?: Record<string, number>
}

const DEFAULT_ALIASES: Record<string, string> = {
  notion: 'notion-database',
  'outlook-calendar': 'microsoft-calendar',
  'microsoft-outlook-calendar': 'microsoft-calendar',
  'microsoft-outlook': 'outlook-mail',
  'gmail-mail': 'gmail',
  'slack-bolt': 'slack',
  stripe: 'stripe-pack',
  twilio: 'twilio-sms',
  'twilio-voice': 'twilio-sms',
}

const DEFAULT_SOURCE_PRECEDENCE: Record<string, number> = {
  'first-party': 500,
  spec: 400,
  gateway: 300,
  'tangle-catalog': 100,
  activepieces: 100,
  coverage: 50,
}

const SUPPORT_RANK: Record<IntegrationSupportTier, number> = {
  catalogOnly: 0,
  setupReady: 1,
  gatewayExecutable: 2,
  firstPartyExecutable: 3,
  sandboxExecutable: 4,
}

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
            runtime: 'tangle-catalog-runtime',
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
 *  WITHOUT executing anything. Defaults to {@link buildDefaultIntegrationRegistry}. */
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

export function composeIntegrationRegistry(
  sources: IntegrationCatalogSource[],
  options: ComposeIntegrationRegistryOptions = {},
): IntegrationRegistry {
  const aliases = { ...DEFAULT_ALIASES, ...(options.aliases ?? {}) }
  const precedence = { ...DEFAULT_SOURCE_PRECEDENCE, ...(options.sourcePrecedence ?? {}) }
  const grouped = new Map<string, Candidate[]>()

  for (const source of sources) {
    for (const connector of source.connectors) {
      const canonicalId = canonicalConnectorId(connector.id, aliases)
      const candidates = grouped.get(canonicalId) ?? []
      candidates.push({
        source,
        connector,
        supportTier: inferIntegrationSupportTier(connector),
      })
      grouped.set(canonicalId, candidates)
    }
  }

  const entries = [...grouped.entries()]
    .map(([canonicalId, candidates]) => registryEntry(canonicalId, candidates, precedence, aliases))
    .sort((a, b) => a.canonicalId.localeCompare(b.canonicalId))
  const byId = new Map<string, IntegrationRegistryEntry>()
  for (const entry of entries) {
    byId.set(entry.canonicalId, entry)
    for (const alias of entry.aliases) byId.set(alias, entry)
  }
  return {
    entries,
    connectors: entries.map((entry) => entry.connector),
    byId,
  }
}

export function summarizeIntegrationRegistry(registry: IntegrationRegistry): IntegrationRegistrySummary {
  const bySupportTier = {
    catalogOnly: 0,
    setupReady: 0,
    gatewayExecutable: 0,
    firstPartyExecutable: 0,
    sandboxExecutable: 0,
  } satisfies Record<IntegrationSupportTier, number>
  for (const entry of registry.entries) bySupportTier[entry.supportTier] += 1
  return {
    totalEntries: registry.entries.length,
    totalSources: registry.entries.reduce((sum, entry) => sum + entry.sources.length, 0),
    toolBindableEntries: registry.entries.filter((entry) => entry.connector.actions.length > 0).length,
    conflictEntries: registry.entries.filter((entry) => entry.conflicts.length > 0).length,
    bySupportTier,
  }
}

export function canonicalConnectorId(id: string, aliases: Record<string, string> = DEFAULT_ALIASES): string {
  const normalized = slug(id)
  let current = normalized
  const seen = new Set<string>()
  while (aliases[current] && !seen.has(current)) {
    seen.add(current)
    current = aliases[current]
  }
  return current
}

export function inferIntegrationSupportTier(connector: IntegrationConnector): IntegrationSupportTier {
  const metadata = connector.metadata ?? {}
  const explicit = metadata.supportTier
  if (isSupportTier(explicit)) return explicit
  if (metadata.sandboxExecutable === true) return 'sandboxExecutable'
  if (metadata.source === 'first-party-adapter' || connector.providerId === 'first-party') return 'firstPartyExecutable'
  if (metadata.source === 'gateway-catalog' && metadata.executable === true) return 'gatewayExecutable'
  if (metadata.source === 'integration-spec') return 'setupReady'
  if (
    metadata.source === 'coverage-catalog'
    || metadata.source === 'activepieces-community'
    || metadata.source === 'tangle-integrations-catalog'
    || metadata.catalogOnly === true
  ) return 'catalogOnly'
  if (connector.actions.length > 0) return 'gatewayExecutable'
  return 'catalogOnly'
}

function registryEntry(
  canonicalId: string,
  candidates: Candidate[],
  precedence: Record<string, number>,
  aliases: Record<string, string>,
): IntegrationRegistryEntry {
  const ordered = [...candidates].sort((a, b) => compareCandidates(a, b, precedence))
  const primary = ordered[0]!
  const actions = mergeActions(ordered)
  const triggers = mergeTriggers(ordered)
  const scopes = unique(toolBindableCandidates(ordered).flatMap((candidate) => candidate.connector.scopes ?? []))
  const supportTier = ordered.reduce<IntegrationSupportTier>(
    (best, candidate) => SUPPORT_RANK[candidate.supportTier] > SUPPORT_RANK[best] ? candidate.supportTier : best,
    primary.supportTier,
  )
  const aliasesForEntry = unique([
    ...ordered.map((candidate) => candidate.connector.id),
    ...Object.entries(aliases)
      .filter(([, target]) => canonicalConnectorId(target, aliases) === canonicalId)
      .map(([alias]) => alias),
  ].map(slug).filter((id) => id && id !== canonicalId)).sort()
  const sources = ordered.map((candidate): IntegrationRegistrySourceRef => ({
    sourceId: candidate.source.id,
    providerId: candidate.connector.providerId,
    connectorId: candidate.connector.id,
    supportTier: candidate.supportTier,
    actionCount: candidate.connector.actions.length,
    triggerCount: candidate.connector.triggers?.length ?? 0,
  }))
  const conflicts = conflictDiagnostics(ordered)

  return {
    canonicalId,
    aliases: aliasesForEntry,
    supportTier,
    sources,
    conflicts,
    connector: {
      ...primary.connector,
      id: canonicalId,
      scopes,
      actions,
      triggers,
      metadata: {
        ...(primary.connector.metadata ?? {}),
        registry: {
          canonicalId,
          aliases: aliasesForEntry,
          supportTier,
          sources,
          conflicts,
          toolBindable: actions.length > 0,
          catalogOnlyActionCount: ordered
            .filter((candidate) => candidate.supportTier === 'catalogOnly')
            .reduce((sum, candidate) => sum + catalogActionCount(candidate.connector), 0),
        },
      },
    },
  }
}

function compareCandidates(a: Candidate, b: Candidate, precedence: Record<string, number>): number {
  return SUPPORT_RANK[b.supportTier] - SUPPORT_RANK[a.supportTier]
    || (b.source.precedence ?? precedence[b.source.id] ?? 0) - (a.source.precedence ?? precedence[a.source.id] ?? 0)
    || b.connector.actions.length - a.connector.actions.length
    || a.connector.id.localeCompare(b.connector.id)
}

function mergeActions(candidates: Candidate[]): IntegrationConnectorAction[] {
  const out = new Map<string, IntegrationConnectorAction>()
  for (const candidate of toolBindableCandidates(candidates)) {
    for (const action of candidate.connector.actions) {
      if (!out.has(action.id)) out.set(action.id, action)
    }
  }
  return [...out.values()]
}

function mergeTriggers(candidates: Candidate[]): IntegrationConnectorTrigger[] | undefined {
  const out = new Map<string, IntegrationConnectorTrigger>()
  for (const candidate of toolBindableCandidates(candidates)) {
    for (const trigger of candidate.connector.triggers ?? []) {
      if (!out.has(trigger.id)) out.set(trigger.id, trigger)
    }
  }
  return out.size > 0 ? [...out.values()] : undefined
}

function toolBindableCandidates(candidates: Candidate[]): Candidate[] {
  const bindable = candidates.filter((candidate) => candidate.supportTier !== 'catalogOnly')
  if (bindable.length === 0) return []
  const maxRank = Math.max(...bindable.map((candidate) => SUPPORT_RANK[candidate.supportTier]))
  return bindable.filter((candidate) => SUPPORT_RANK[candidate.supportTier] === maxRank)
}

function catalogActionCount(connector: IntegrationConnector): number {
  const value = connector.metadata?.catalogActionCount
  return typeof value === 'number' ? value : connector.actions.length
}

function conflictDiagnostics(candidates: Candidate[]): IntegrationRegistryConflict[] {
  return [
    conflictFor('auth', candidates.map((candidate) => ({
      value: candidate.connector.auth,
      sourceId: candidate.source.id,
      connectorId: candidate.connector.id,
    }))),
    conflictFor('category', candidates.map((candidate) => ({
      value: candidate.connector.category,
      sourceId: candidate.source.id,
      connectorId: candidate.connector.id,
    }))),
  ].filter((conflict): conflict is IntegrationRegistryConflict => Boolean(conflict))
}

function conflictFor(
  field: IntegrationRegistryConflict['field'],
  values: IntegrationRegistryConflict['values'],
): IntegrationRegistryConflict | undefined {
  const uniqueValues = new Set(values.map((entry) => entry.value))
  if (uniqueValues.size <= 1) return undefined
  return { field, values }
}

function isSupportTier(value: unknown): value is IntegrationSupportTier {
  return value === 'catalogOnly'
    || value === 'setupReady'
    || value === 'gatewayExecutable'
    || value === 'firstPartyExecutable'
    || value === 'sandboxExecutable'
}

function slug(value: string): string {
  return value.trim().toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

interface Candidate {
  source: IntegrationCatalogSource
  connector: IntegrationConnector
  supportTier: IntegrationSupportTier
}
