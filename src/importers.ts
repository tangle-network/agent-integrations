import type {
  IntegrationActionRisk,
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorCategory,
  IntegrationDataClass,
} from './index.js'

export interface ImportCatalogOptions {
  providerId: string
  connectorId: string
  connectorTitle: string
  category?: IntegrationConnectorCategory
  auth?: IntegrationConnector['auth']
  scopes?: string[]
  dataClass?: IntegrationDataClass
  defaultRisk?: IntegrationActionRisk
}

export interface OpenApiDocument {
  openapi?: string
  swagger?: string
  info?: { title?: string }
  paths?: Record<string, Record<string, OpenApiOperation | unknown>>
}

export interface OpenApiOperation {
  operationId?: string
  summary?: string
  description?: string
  parameters?: unknown[]
  requestBody?: unknown
  responses?: unknown
  security?: Array<Record<string, string[]>>
  tags?: string[]
}

export interface GraphqlOperationSpec {
  name: string
  kind: 'query' | 'mutation'
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
  requiredScopes?: string[]
}

export interface McpCatalogTool {
  name: string
  description?: string
  inputSchema?: unknown
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    openWorldHint?: boolean
    title?: string
  }
}

export interface McpCatalog {
  tools: McpCatalogTool[]
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])

export function importOpenApiConnector(document: OpenApiDocument, options: ImportCatalogOptions): IntegrationConnector {
  const actions: IntegrationConnectorAction[] = []
  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, rawOperation] of Object.entries(methods)) {
      const normalizedMethod = method.toLowerCase()
      if (!HTTP_METHODS.has(normalizedMethod) || !isObject(rawOperation)) continue
      const operation = rawOperation as OpenApiOperation
      const operationId = operation.operationId ?? `${normalizedMethod}_${path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
      actions.push({
        id: operationId,
        title: operation.summary ?? titleFromId(operationId),
        risk: riskFromHttpMethod(normalizedMethod, operation, options.defaultRisk),
        requiredScopes: scopesFromOpenApiOperation(operation, options.scopes ?? []),
        dataClass: options.dataClass ?? 'private',
        description: operation.description ?? operation.summary ?? `${normalizedMethod.toUpperCase()} ${path}`,
        approvalRequired: riskFromHttpMethod(normalizedMethod, operation, options.defaultRisk) !== 'read',
        inputSchema: openApiInputSchema(path, normalizedMethod, operation),
        outputSchema: operation.responses,
      })
    }
  }
  return connectorFromActions(options, actions)
}

export function importGraphqlConnector(operations: GraphqlOperationSpec[], options: ImportCatalogOptions): IntegrationConnector {
  return connectorFromActions(options, operations.map((operation) => ({
    id: operation.name,
    title: titleFromId(operation.name),
    risk: operation.kind === 'query' ? 'read' : options.defaultRisk ?? 'write',
    requiredScopes: operation.requiredScopes ?? options.scopes ?? [],
    dataClass: options.dataClass ?? 'private',
    description: operation.description,
    approvalRequired: operation.kind === 'mutation',
    inputSchema: operation.inputSchema,
    outputSchema: operation.outputSchema,
  })))
}

export function importMcpConnector(catalog: McpCatalog, options: ImportCatalogOptions): IntegrationConnector {
  return connectorFromActions(options, catalog.tools.map((tool) => {
    const risk = riskFromMcpTool(tool, options.defaultRisk)
    return {
      id: tool.name,
      title: tool.annotations?.title ?? titleFromId(tool.name),
      risk,
      requiredScopes: options.scopes ?? [],
      dataClass: options.dataClass ?? 'private',
      description: tool.description,
      approvalRequired: risk !== 'read',
      inputSchema: tool.inputSchema,
    }
  }))
}

function connectorFromActions(options: ImportCatalogOptions, actions: IntegrationConnectorAction[]): IntegrationConnector {
  const scopes = unique([
    ...(options.scopes ?? []),
    ...actions.flatMap((action) => action.requiredScopes),
  ])
  return {
    id: options.connectorId,
    providerId: options.providerId,
    title: options.connectorTitle,
    category: options.category ?? 'other',
    auth: options.auth ?? 'custom',
    scopes,
    actions,
    metadata: { source: 'catalog-importer' },
  }
}

function riskFromHttpMethod(method: string, operation: OpenApiOperation, fallback?: IntegrationActionRisk): IntegrationActionRisk {
  if (method === 'get') return 'read'
  if (method === 'delete') return 'destructive'
  const text = `${operation.operationId ?? ''} ${operation.summary ?? ''} ${operation.description ?? ''}`.toLowerCase()
  if (/\b(delete|remove|destroy|cancel|void|revoke|drop)\b/.test(text)) return 'destructive'
  return fallback && fallback !== 'read' ? fallback : 'write'
}

function riskFromMcpTool(tool: McpCatalogTool, fallback?: IntegrationActionRisk): IntegrationActionRisk {
  if (tool.annotations?.destructiveHint) return 'destructive'
  if (tool.annotations?.readOnlyHint) return 'read'
  const text = `${tool.name} ${tool.description ?? ''}`.toLowerCase()
  if (/\b(delete|remove|destroy|cancel|void|revoke|drop)\b/.test(text)) return 'destructive'
  if (/\b(get|list|read|search|find|fetch|query)\b/.test(text)) return 'read'
  return fallback ?? 'write'
}

function scopesFromOpenApiOperation(operation: OpenApiOperation, fallback: string[]): string[] {
  const scopes = (operation.security ?? []).flatMap((entry) => Object.values(entry).flat())
  return unique(scopes.length > 0 ? scopes : fallback)
}

function openApiInputSchema(path: string, method: string, operation: OpenApiOperation): unknown {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      path: { const: path },
      method: { const: method.toUpperCase() },
      parameters: { type: 'object', additionalProperties: true },
      body: operation.requestBody ?? { type: 'object', additionalProperties: true },
    },
  }
}

function titleFromId(id: string): string {
  return id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
