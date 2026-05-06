import type {
  CompleteAuthRequest,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationConnection,
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorCategory,
  IntegrationConnectorTrigger,
  IntegrationDataClass,
  IntegrationProvider,
  IntegrationProviderKind,
  StartAuthRequest,
  StartAuthResult,
} from './index.js'
import { IntegrationError } from './index.js'

export interface GatewayCatalogProviderOptions {
  id: string
  kind: Extract<IntegrationProviderKind, 'nango' | 'pipedream' | 'activepieces' | 'tangle_catalog' | 'zapier' | 'executor' | 'custom'>
  fetchCatalog: () => Promise<GatewayCatalogEntry[]> | GatewayCatalogEntry[]
  startAuth?: (request: StartAuthRequest) => Promise<StartAuthResult> | StartAuthResult
  completeAuth?: (request: CompleteAuthRequest) => Promise<IntegrationConnection> | IntegrationConnection
  invokeAction?: (connection: IntegrationConnection, request: IntegrationActionRequest) => Promise<IntegrationActionResult> | IntegrationActionResult
  cacheTtlMs?: number
  now?: () => Date
}

export interface GatewayCatalogEntry {
  id?: string
  key?: string
  name?: string
  title?: string
  category?: string
  auth?: 'oauth2' | 'api_key' | 'none' | 'custom' | string
  scopes?: string[]
  actions?: GatewayCatalogAction[]
  triggers?: GatewayCatalogTrigger[]
  metadata?: Record<string, unknown>
}

export interface GatewayCatalogAction {
  id?: string
  key?: string
  name?: string
  title?: string
  description?: string
  risk?: 'read' | 'write' | 'destructive' | string
  scopes?: string[]
  requiredScopes?: string[]
  dataClass?: IntegrationDataClass | string
  approvalRequired?: boolean
  inputSchema?: unknown
  outputSchema?: unknown
}

export interface GatewayCatalogTrigger {
  id?: string
  key?: string
  name?: string
  title?: string
  description?: string
  scopes?: string[]
  requiredScopes?: string[]
  dataClass?: IntegrationDataClass | string
  payloadSchema?: unknown
}

export function createGatewayCatalogProvider(options: GatewayCatalogProviderOptions): IntegrationProvider {
  const now = options.now ?? (() => new Date())
  let cachedAt = 0
  let cached: IntegrationConnector[] | undefined

  async function listConnectors(): Promise<IntegrationConnector[]> {
    const ttl = options.cacheTtlMs ?? 60_000
    const current = now().getTime()
    if (cached && current - cachedAt < ttl) return cached
    const entries = await options.fetchCatalog()
    cached = normalizeGatewayCatalog(entries, {
      providerId: options.id,
      providerKind: options.kind,
    })
    cachedAt = current
    return cached
  }

  return {
    id: options.id,
    kind: options.kind,
    listConnectors,
    startAuth: options.startAuth,
    completeAuth: options.completeAuth,
    async invokeAction(connection, request) {
      if (!options.invokeAction) {
        throw new IntegrationError(`Gateway provider ${options.id} does not implement action invocation.`, 'action_not_found')
      }
      await assertKnownGatewayAction(await listConnectors(), connection.connectorId, request.action)
      return options.invokeAction(connection, request)
    },
  }
}

export function normalizeGatewayCatalog(
  entries: GatewayCatalogEntry[],
  options: { providerId: string; providerKind: IntegrationProviderKind },
): IntegrationConnector[] {
  const out: IntegrationConnector[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const id = slug(entry.id ?? entry.key ?? entry.name ?? entry.title ?? '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    const title = entry.title ?? entry.name ?? titleFromId(id)
    const actions = normalizeActions(entry.actions ?? [], entry.scopes ?? [])
    out.push({
      id,
      providerId: options.providerId,
      title,
      category: normalizeCategory(entry.category),
      auth: normalizeAuth(entry.auth),
      scopes: unique([
        ...(entry.scopes ?? []),
        ...actions.flatMap((action) => action.requiredScopes),
      ]),
      actions: actions.length > 0 ? actions : defaultActionsFor(entry.category, entry.scopes ?? []),
      triggers: normalizeTriggers(entry.triggers ?? [], entry.scopes ?? []),
      metadata: {
        ...(entry.metadata ?? {}),
        source: 'gateway-catalog',
        providerKind: options.providerKind,
        executable: true,
      },
    })
  }
  return out
}

async function assertKnownGatewayAction(connectors: IntegrationConnector[], connectorId: string, actionId: string): Promise<void> {
  const connector = connectors.find((candidate) => candidate.id === connectorId)
  if (!connector) throw new IntegrationError(`Connector ${connectorId} not found.`, 'connector_not_found')
  if (!connector.actions.some((action) => action.id === actionId)) {
    throw new IntegrationError(`Action ${actionId} is not defined by connector ${connectorId}.`, 'action_not_found')
  }
}

function normalizeActions(actions: GatewayCatalogAction[], fallbackScopes: string[]): IntegrationConnectorAction[] {
  return actions.map((action) => {
    const id = slug(action.id ?? action.key ?? action.name ?? action.title ?? '')
    return {
      id,
      title: action.title ?? action.name ?? titleFromId(id),
      risk: normalizeRisk(action.risk),
      requiredScopes: unique([
        ...(action.requiredScopes ?? []),
        ...(action.scopes ?? []),
        ...((action.requiredScopes?.length || action.scopes?.length) ? [] : fallbackScopes),
      ]),
      dataClass: normalizeDataClass(action.dataClass),
      description: action.description,
      approvalRequired: action.approvalRequired ?? normalizeRisk(action.risk) !== 'read',
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
    }
  }).filter((action) => action.id)
}

function normalizeTriggers(triggers: GatewayCatalogTrigger[], fallbackScopes: string[]): IntegrationConnectorTrigger[] | undefined {
  const normalized = triggers.map((trigger) => {
    const id = slug(trigger.id ?? trigger.key ?? trigger.name ?? trigger.title ?? '')
    return {
      id,
      title: trigger.title ?? trigger.name ?? titleFromId(id),
      requiredScopes: unique([
        ...(trigger.requiredScopes ?? []),
        ...(trigger.scopes ?? []),
        ...((trigger.requiredScopes?.length || trigger.scopes?.length) ? [] : fallbackScopes),
      ]),
      dataClass: normalizeDataClass(trigger.dataClass),
      description: trigger.description,
      payloadSchema: trigger.payloadSchema,
    }
  }).filter((trigger) => trigger.id)
  return normalized.length > 0 ? normalized : undefined
}

function defaultActionsFor(category: string | undefined, scopes: string[]): IntegrationConnectorAction[] {
  const readScope = scopes.find((scope) => scope.endsWith('.read')) ?? scopes[0]
  const writeScope = scopes.find((scope) => scope.endsWith('.write')) ?? scopes[1] ?? readScope
  const requiredRead = readScope ? [readScope] : []
  const requiredWrite = writeScope ? [writeScope] : []
  const dataClass = normalizeDataClass(category === 'finance' || category === 'commerce' || category === 'hr' ? 'sensitive' : 'private')
  return [
    {
      id: 'records.search',
      title: 'Search records',
      risk: 'read',
      requiredScopes: requiredRead,
      dataClass,
      description: 'Search provider records.',
    },
    {
      id: 'records.read',
      title: 'Read record',
      risk: 'read',
      requiredScopes: requiredRead,
      dataClass,
      description: 'Read a provider record.',
    },
    {
      id: 'records.upsert',
      title: 'Upsert record',
      risk: 'write',
      requiredScopes: requiredWrite,
      dataClass,
      approvalRequired: true,
      description: 'Create or update a provider record.',
    },
  ]
}

function normalizeCategory(category: string | undefined): IntegrationConnectorCategory {
  const value = slug(category ?? '')
  if (value === 'mail') return 'email'
  if (value === 'messaging' || value === 'communication' || value === 'communications') return 'chat'
  if (value === 'file' || value === 'files') return 'storage'
  if (value === 'project-management' || value === 'automation') return 'workflow'
  if (value === 'developer' || value === 'devops') return 'workflow'
  if (value === 'support') return 'crm'
  if ([
    'email',
    'calendar',
    'chat',
    'crm',
    'storage',
    'docs',
    'database',
    'webhook',
    'workflow',
    'internal',
    'other',
  ].includes(value)) return value as IntegrationConnectorCategory
  return 'other'
}

function normalizeAuth(auth: GatewayCatalogEntry['auth']): IntegrationConnector['auth'] {
  if (auth === 'oauth2') return 'oauth2'
  if (auth === 'api_key' || auth === 'api-key' || auth === 'apikey') return 'api_key'
  if (auth === 'none') return 'none'
  return 'custom'
}

function normalizeRisk(risk: GatewayCatalogAction['risk']): IntegrationConnectorAction['risk'] {
  if (risk === 'read' || risk === 'write' || risk === 'destructive') return risk
  return 'write'
}

function normalizeDataClass(dataClass: GatewayCatalogAction['dataClass']): IntegrationDataClass {
  if (dataClass === 'public' || dataClass === 'internal' || dataClass === 'private' || dataClass === 'sensitive' || dataClass === 'secret') return dataClass
  return 'private'
}

function slug(value: string): string {
  return value.trim().toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function titleFromId(id: string): string {
  return id.split('-').filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
