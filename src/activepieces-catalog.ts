import type {
  IntegrationActionRisk,
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorCategory,
  IntegrationConnectorTrigger,
  IntegrationDataClass,
} from './index.js'
import { ACTIVEPIECES_COMMUNITY_CATALOG } from './activepieces-catalog.generated.js'

export interface ActivepiecesCatalogEntry {
  id: string
  title: string
  description: string
  npmPackage?: string
  version?: string
  category: IntegrationConnectorCategory
  auth: IntegrationConnector['auth']
  domains: string[]
  actions: Array<{
    id: string
    title: string
    risk: IntegrationActionRisk
  }>
  triggers: Array<{
    id: string
    title: string
  }>
  source: {
    repository: string
    path: string
    license: 'MIT'
  }
}

export function listActivepiecesCatalogEntries(): ActivepiecesCatalogEntry[] {
  return ACTIVEPIECES_COMMUNITY_CATALOG.map((entry) => ({
    ...entry,
    actions: [...entry.actions],
    triggers: [...entry.triggers],
    domains: [...entry.domains],
    source: { ...entry.source },
  }))
}

export function buildActivepiecesConnectors(options: { providerId?: string } = {}): IntegrationConnector[] {
  const providerId = options.providerId ?? 'activepieces'
  return listActivepiecesCatalogEntries().map((entry) => {
    const scopes = [`${entry.id}.read`, `${entry.id}.write`]
    const actions = entry.actions.length > 0
      ? entry.actions.map((action) => toAction(action, scopes, dataClassFor(entry.category)))
      : defaultActions(entry.id, scopes, dataClassFor(entry.category))
    return {
      id: entry.id,
      providerId,
      title: entry.title,
      category: entry.category,
      auth: entry.auth,
      scopes,
      actions,
      triggers: entry.triggers.map((trigger) => toTrigger(trigger, scopes, dataClassFor(entry.category))),
      metadata: {
        source: 'activepieces-community',
        executable: false,
        runtime: 'activepieces-piece',
        catalogOnly: true,
        npmPackage: entry.npmPackage,
        version: entry.version,
        license: entry.source.license,
        sourcePath: entry.source.path,
        domains: entry.domains,
      },
    }
  })
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
      description: `Create or update a ${id} record through an Activepieces-backed connector.`,
    },
  ]
}

function dataClassFor(category: IntegrationConnectorCategory): IntegrationDataClass {
  if (category === 'database' || category === 'storage' || category === 'email') return 'private'
  if (category === 'crm' || category === 'chat' || category === 'docs') return 'private'
  if (category === 'internal') return 'sensitive'
  return 'internal'
}
