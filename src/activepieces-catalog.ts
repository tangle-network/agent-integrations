import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type {
  IntegrationActionRisk,
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorCategory,
  IntegrationConnectorTrigger,
  IntegrationDataClass,
} from './index.js'
import { getActivepiecesOverride } from './activepieces-overrides.js'

export interface ActivepiecesCatalogEntry {
  id: string
  title: string
  description: string
  npmPackage?: string
  version?: string
  category: IntegrationConnectorCategory
  auth: IntegrationConnector['auth']
  authFields?: ActivepiecesCatalogAuthField[]
  domains: string[]
  actions: Array<{
    id: string
    title: string
    risk: IntegrationActionRisk
    upstreamName?: string
  }>
  triggers: Array<{
    id: string
    title: string
    upstreamName?: string
  }>
  source: {
    repository: string
    path: string
    license: 'MIT'
  }
}

export interface ActivepiecesCatalogAuthField {
  key: string
  label: string
  required: boolean
  secret: boolean
  kind: 'text' | 'number' | 'boolean' | 'select' | 'object' | 'unknown'
  description?: string
}

const CATALOG_RESOURCE_RELATIVE = '../data/activepieces-catalog.json'

let CACHED_CATALOG: ReadonlyArray<ActivepiecesCatalogEntry> | undefined

function loadCatalog(): ReadonlyArray<ActivepiecesCatalogEntry> {
  if (CACHED_CATALOG) return CACHED_CATALOG
  const here = dirname(fileURLToPath(import.meta.url))
  const path = resolve(here, CATALOG_RESOURCE_RELATIVE)
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as ActivepiecesCatalogEntry[]
  CACHED_CATALOG = parsed
  return parsed
}

export function listActivepiecesCatalogEntries(): ActivepiecesCatalogEntry[] {
  return loadCatalog().map((entry) => ({
    ...entry,
    actions: [...entry.actions],
    triggers: [...entry.triggers],
    domains: [...entry.domains],
    source: { ...entry.source },
  }))
}

export function buildActivepiecesConnectors(options: {
  providerId?: string
  includeCatalogActions?: boolean
  executable?: boolean
} = {}): IntegrationConnector[] {
  const providerId = options.providerId ?? 'activepieces'
  const executable = options.executable === true
  return listActivepiecesCatalogEntries().map((entry) => {
    const override = getActivepiecesOverride(entry.id)
    const category = override?.category ?? entry.category
    const scopes = [`${entry.id}.read`, `${entry.id}.write`]
    const catalogActions = entry.actions.length > 0
      ? entry.actions.map((action) => toAction(applyActionOverride(action, override), scopes, dataClassFor(category)))
      : defaultActions(entry.id, scopes, dataClassFor(category))
    const catalogTriggers = entry.triggers.map((trigger) => toTrigger(trigger, scopes, dataClassFor(category)))
    return {
      id: entry.id,
      providerId,
      title: entry.title,
      category,
      auth: entry.auth,
      scopes: options.includeCatalogActions ? scopes : [],
      actions: options.includeCatalogActions ? catalogActions : [],
      triggers: options.includeCatalogActions ? catalogTriggers : undefined,
      metadata: {
        source: 'activepieces-community',
        executable,
        runtime: 'activepieces-piece',
        catalogOnly: !executable,
        supportTier: executable ? 'gatewayExecutable' : 'catalogOnly',
        catalogActionCount: catalogActions.length,
        catalogTriggerCount: catalogTriggers.length,
        npmPackage: entry.npmPackage,
        version: entry.version,
        license: entry.source.license,
        sourcePath: entry.source.path,
        domains: entry.domains,
        authFields: entry.authFields,
        ...(override ? { overridden: true } : {}),
      },
    }
  })
}

function applyActionOverride(
  action: ActivepiecesCatalogEntry['actions'][number],
  override: ReturnType<typeof getActivepiecesOverride>,
): ActivepiecesCatalogEntry['actions'][number] {
  if (!override) return action
  const risk = override.actionRisks?.[action.id] ?? action.risk
  return { ...action, risk }
}

function toAction(
  action: ActivepiecesCatalogEntry['actions'][number],
  scopes: string[],
  dataClass: IntegrationDataClass,
): IntegrationConnectorAction {
  return {
    id: action.id,
    title: action.title,
    risk: action.risk,
    requiredScopes: action.risk === 'read' ? [scopes[0]!] : [scopes[1]!],
    dataClass,
    approvalRequired: action.risk !== 'read',
    inputSchema: { type: 'object', additionalProperties: true, properties: {} },
  }
}

function toTrigger(
  trigger: ActivepiecesCatalogEntry['triggers'][number],
  scopes: string[],
  dataClass: IntegrationDataClass,
): IntegrationConnectorTrigger {
  return {
    id: trigger.id,
    title: trigger.title,
    requiredScopes: [scopes[0]!],
    dataClass,
    payloadSchema: { type: 'object', additionalProperties: true, properties: {} },
  }
}

function defaultActions(
  id: string,
  scopes: string[],
  dataClass: IntegrationDataClass,
): IntegrationConnectorAction[] {
  return [
    {
      id: 'records.search',
      title: 'Search records',
      risk: 'read',
      requiredScopes: [scopes[0]!],
      dataClass,
      inputSchema: { type: 'object', additionalProperties: true, properties: {} },
    },
    {
      id: 'records.upsert',
      title: 'Upsert record',
      risk: 'write',
      requiredScopes: [scopes[1]!],
      dataClass,
      approvalRequired: true,
      inputSchema: { type: 'object', additionalProperties: true, properties: {} },
      description: `Create or update a ${id} record through a catalog-backed connector.`,
    },
  ]
}

function dataClassFor(category: IntegrationConnectorCategory): IntegrationDataClass {
  if (category === 'database' || category === 'storage' || category === 'email') return 'private'
  if (category === 'crm' || category === 'chat' || category === 'docs') return 'private'
  if (category === 'internal') return 'sensitive'
  return 'internal'
}
