import type {
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorCategory,
  IntegrationActionRisk,
  IntegrationDataClass,
} from './index.js'

export interface IntegrationToolDefinition {
  name: string
  title: string
  description: string
  providerId: string
  connectorId: string
  connectorTitle: string
  category: IntegrationConnectorCategory
  action: IntegrationConnectorAction
  risk: IntegrationActionRisk
  dataClass: IntegrationDataClass
  requiredScopes: string[]
  inputSchema?: unknown
  outputSchema?: unknown
  tags: string[]
}

export interface IntegrationToolSearchFilters {
  providerId?: string
  connectorId?: string
  category?: IntegrationConnectorCategory
  maxRisk?: IntegrationActionRisk
  dataClass?: IntegrationDataClass
  limit?: number
}

export interface IntegrationToolSearchResult {
  tool: IntegrationToolDefinition
  score: number
  matched: string[]
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: unknown
}

const riskRank: Record<IntegrationActionRisk, number> = {
  read: 0,
  write: 1,
  destructive: 2,
}

export function integrationToolName(providerId: string, connectorId: string, actionId: string): string {
  return `int_${encodeToolPart(providerId)}_${encodeToolPart(connectorId)}_${encodeToolPart(actionId)}`
}

export function parseIntegrationToolName(name: string): { providerId: string; connectorId: string; actionId: string } {
  const parts = name.split('_')
  if (parts.length !== 4 || parts[0] !== 'int') {
    throw new Error(`Invalid integration tool name: ${name}`)
  }
  return {
    providerId: decodeToolPart(parts[1]),
    connectorId: decodeToolPart(parts[2]),
    actionId: decodeToolPart(parts[3]),
  }
}

export function buildIntegrationToolCatalog(connectors: IntegrationConnector[]): IntegrationToolDefinition[] {
  const tools: IntegrationToolDefinition[] = []
  for (const connector of connectors) {
    for (const action of connector.actions) {
      const tags = unique([
        connector.id,
        connector.providerId,
        connector.title,
        connector.category,
        action.id,
        action.title,
        action.risk,
        action.dataClass,
        ...(connector.scopes ?? []),
        ...(action.requiredScopes ?? []),
      ].flatMap(tokenize))
      tools.push({
        name: integrationToolName(connector.providerId, connector.id, action.id),
        title: `${connector.title}: ${action.title}`,
        description: action.description ?? `${action.risk} action ${action.id} on ${connector.title}`,
        providerId: connector.providerId,
        connectorId: connector.id,
        connectorTitle: connector.title,
        category: connector.category,
        action,
        risk: action.risk,
        dataClass: action.dataClass,
        requiredScopes: action.requiredScopes,
        inputSchema: action.inputSchema,
        outputSchema: action.outputSchema,
        tags,
      })
    }
  }
  return tools
}

export function searchIntegrationTools(
  catalog: IntegrationToolDefinition[],
  query: string,
  filters: IntegrationToolSearchFilters = {},
): IntegrationToolSearchResult[] {
  const terms = tokenize(query)
  const filtered = catalog.filter((tool) => {
    if (filters.providerId && tool.providerId !== filters.providerId) return false
    if (filters.connectorId && tool.connectorId !== filters.connectorId) return false
    if (filters.category && tool.category !== filters.category) return false
    if (filters.dataClass && tool.dataClass !== filters.dataClass) return false
    if (filters.maxRisk && riskRank[tool.risk] > riskRank[filters.maxRisk]) return false
    return true
  })
  const scored = filtered.map((tool) => scoreTool(tool, terms))
  return scored
    .filter((result) => terms.length === 0 || result.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, filters.limit ?? 20)
}

export function toMcpTools(tools: IntegrationToolDefinition[]): McpToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: `${tool.title}. ${tool.description}`,
    inputSchema: tool.inputSchema ?? {
      type: 'object',
      additionalProperties: true,
      properties: {},
    },
  }))
}

function scoreTool(tool: IntegrationToolDefinition, terms: string[]): IntegrationToolSearchResult {
  if (terms.length === 0) return { tool, score: 1, matched: [] }
  const haystack = new Set(tool.tags)
  const matched: string[] = []
  let score = 0
  for (const term of terms) {
    if (haystack.has(term)) {
      matched.push(term)
      score += 4
      continue
    }
    if (tool.tags.some((tag) => tag.includes(term))) {
      matched.push(term)
      score += 1
    }
  }
  if (tool.risk === 'read') score += 0.25
  return { tool, score, matched: unique(matched) }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
}

function encodeToolPart(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeToolPart(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
