import type {
  IntegrationConnector,
  IntegrationConnectorAction,
} from './index.js'
import type {
  IntegrationManifest,
  IntegrationManifestResolution,
  IntegrationRequirement,
} from './runtime.js'

export interface ConsentSummary {
  title: string
  body: string
  bullets: string[]
  primaryAction: string
  risk: 'read' | 'write' | 'destructive'
  connectorIds: string[]
}

export interface RenderConsentOptions {
  appName?: string
  connectors?: IntegrationConnector[]
}

export function renderConsentSummary(
  manifestOrResolution: IntegrationManifest | IntegrationManifestResolution,
  options: RenderConsentOptions = {},
): ConsentSummary {
  const manifest = 'manifest' in manifestOrResolution ? manifestOrResolution.manifest : manifestOrResolution
  const appName = options.appName ?? manifest.title ?? manifest.id
  const requirements = manifest.requirements
  const risk = aggregateRisk(requirements, options.connectors)
  const connectorIds = unique(requirements.map((requirement) => requirement.connectorId))
  const first = requirements[0]
  const body = first ? sentenceForRequirement(appName, first) : `${appName} does not request integrations.`
  return {
    title: `${appName} wants to use ${humanList(connectorIds.map(titleize))}`,
    body,
    bullets: requirements.map((requirement) => bulletForRequirement(requirement, options.connectors)),
    primaryAction: risk === 'read' ? 'Allow access' : risk === 'write' ? 'Review and allow' : 'Review destructive access',
    risk,
    connectorIds,
  }
}

export function renderApprovalCopy(input: {
  appName: string
  connectorTitle: string
  action: IntegrationConnectorAction
  approvalId?: string
}): ConsentSummary {
  return {
    title: `${input.appName} wants to ${input.action.title.toLowerCase()}`,
    body: `${input.appName} is requesting permission to run "${input.action.title}" on ${input.connectorTitle}.`,
    bullets: [
      `Risk: ${input.action.risk}`,
      `Data: ${input.action.dataClass}`,
      ...(input.approvalId ? [`Approval id: ${input.approvalId}`] : []),
    ],
    primaryAction: input.action.risk === 'read' ? 'Allow' : 'Approve action',
    risk: input.action.risk,
    connectorIds: [],
  }
}

function sentenceForRequirement(appName: string, requirement: IntegrationRequirement): string {
  if (requirement.connectorId === 'google-calendar' && requirement.mode === 'read') {
    return `${appName} wants to read your Google Calendar to find schedule-aware recommendations.`
  }
  if (requirement.connectorId === 'google-calendar' && requirement.mode === 'write') {
    return `${appName} wants to create or update Google Calendar events after your approval.`
  }
  if (requirement.mode === 'read') return `${appName} wants to read ${titleize(requirement.connectorId)} data.`
  if (requirement.mode === 'write') return `${appName} wants to write ${titleize(requirement.connectorId)} data after approval.`
  return `${appName} wants to subscribe to ${titleize(requirement.connectorId)} events.`
}

function bulletForRequirement(requirement: IntegrationRequirement, connectors: IntegrationConnector[] = []): string {
  const connector = connectors.find((candidate) => candidate.id === requirement.connectorId)
  const actions = requirement.requiredActions?.length
    ? requirement.requiredActions.map((id) => connector?.actions.find((action) => action.id === id)?.title ?? id)
    : requirement.requiredTriggers ?? []
  return `${titleize(requirement.connectorId)}: ${requirement.reason}${actions.length ? ` (${actions.join(', ')})` : ''}`
}

function aggregateRisk(requirements: IntegrationRequirement[], connectors: IntegrationConnector[] = []): 'read' | 'write' | 'destructive' {
  let rank = 0
  for (const requirement of requirements) {
    if (requirement.mode === 'write') rank = Math.max(rank, 1)
    const connector = connectors.find((candidate) => candidate.id === requirement.connectorId)
    for (const actionId of requirement.requiredActions ?? []) {
      const risk = connector?.actions.find((action) => action.id === actionId)?.risk
      if (risk === 'write') rank = Math.max(rank, 1)
      if (risk === 'destructive') rank = Math.max(rank, 2)
    }
  }
  return rank === 2 ? 'destructive' : rank === 1 ? 'write' : 'read'
}

function humanList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? 'integrations'
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

function titleize(value: string): string {
  return value.split(/[-_.]/g).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
