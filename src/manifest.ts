import { CANONICAL_INTEGRATION_ACTIONS, canonicalActionConnectorId } from './actions.js'
import type {
  IntegrationManifest,
  IntegrationManifestResolution,
  IntegrationRequirement,
  IntegrationRequirementMode,
} from './runtime.js'

export interface ManifestValidationIssue {
  path: string
  message: string
}

export interface ManifestValidationResult {
  ok: boolean
  issues: ManifestValidationIssue[]
}

export interface InferIntegrationRequirementsOptions {
  manifestId: string
  title?: string
  tools: Array<string | { action: string; reason?: string; mode?: IntegrationRequirementMode; connectorId?: string; scopes?: string[] }>
  metadata?: Record<string, unknown>
}

export interface MissingRequirementExplanation {
  requirementId: string
  connectorId: string
  status: string
  message: string
  userAction: 'connect' | 'enable' | 'ignore_optional'
}

export function validateIntegrationManifest(manifest: IntegrationManifest): ManifestValidationResult {
  const issues: ManifestValidationIssue[] = []
  if (!manifest.id?.trim()) issues.push({ path: 'id', message: 'Manifest id is required.' })
  if (!Array.isArray(manifest.requirements)) issues.push({ path: 'requirements', message: 'Requirements must be an array.' })
  const ids = new Set<string>()
  for (const [index, requirement] of (manifest.requirements ?? []).entries()) {
    const path = `requirements[${index}]`
    if (!requirement.id?.trim()) issues.push({ path: `${path}.id`, message: 'Requirement id is required.' })
    if (ids.has(requirement.id)) issues.push({ path: `${path}.id`, message: `Duplicate requirement id ${requirement.id}.` })
    ids.add(requirement.id)
    if (!requirement.connectorId?.trim()) issues.push({ path: `${path}.connectorId`, message: 'Connector id is required.' })
    if (!['read', 'write', 'trigger'].includes(requirement.mode)) issues.push({ path: `${path}.mode`, message: 'Mode must be read, write, or trigger.' })
    if (!requirement.reason?.trim()) issues.push({ path: `${path}.reason`, message: 'Human-readable reason is required.' })
    if (requirement.mode !== 'trigger' && !requirement.requiredActions?.length) {
      issues.push({ path: `${path}.requiredActions`, message: 'Non-trigger requirements should list required actions.' })
    }
    if (requirement.mode === 'trigger' && !requirement.requiredTriggers?.length) {
      issues.push({ path: `${path}.requiredTriggers`, message: 'Trigger requirements should list required triggers.' })
    }
  }
  return { ok: issues.length === 0, issues }
}

export function assertValidIntegrationManifest(manifest: IntegrationManifest): void {
  const result = validateIntegrationManifest(manifest)
  if (!result.ok) {
    throw new Error(`Invalid integration manifest: ${result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`)
  }
}

export function inferIntegrationManifestFromTools(options: InferIntegrationRequirementsOptions): IntegrationManifest {
  const byConnector = new Map<string, IntegrationRequirement>()
  for (const item of options.tools) {
    const action = typeof item === 'string' ? item : item.action
    const connectorId = typeof item === 'string' ? canonicalActionConnectorId(action) : item.connectorId ?? canonicalActionConnectorId(action)
    if (!connectorId) continue
    const mode = typeof item === 'string' ? inferMode(action) : item.mode ?? inferMode(action)
    const id = `${connectorId}-${mode}`
    const existing = byConnector.get(id)
    const reason = typeof item === 'string' ? defaultReason(connectorId, mode) : item.reason ?? defaultReason(connectorId, mode)
    if (existing) {
      byConnector.set(id, {
        ...existing,
        requiredActions: unique([...(existing.requiredActions ?? []), action]),
        requiredScopes: unique([...(existing.requiredScopes ?? []), ...(typeof item === 'string' ? [] : item.scopes ?? [])]),
      })
    } else {
      byConnector.set(id, {
        id,
        connectorId,
        mode,
        reason,
        requiredActions: mode === 'trigger' ? undefined : [action],
        requiredScopes: typeof item === 'string' ? undefined : item.scopes,
      })
    }
  }
  const manifest: IntegrationManifest = {
    id: options.manifestId,
    title: options.title,
    requirements: [...byConnector.values()],
    metadata: options.metadata,
  }
  assertValidIntegrationManifest(manifest)
  return manifest
}

export function explainMissingRequirements(resolution: IntegrationManifestResolution): MissingRequirementExplanation[] {
  return [...resolution.missing, ...resolution.optionalMissing].map((item) => ({
    requirementId: item.requirement.id,
    connectorId: item.requirement.connectorId,
    status: item.status,
    message: item.message,
    userAction: item.requirement.optional ? 'ignore_optional' : item.status === 'not_executable' ? 'enable' : 'connect',
  }))
}

export function calendarExercisePlannerManifest(id = 'exercise-calendar-planner'): IntegrationManifest {
  return {
    id,
    title: 'Exercise Calendar Planner',
    requirements: [{
      id: 'calendar-read',
      connectorId: 'google-calendar',
      mode: 'read',
      reason: 'Read busy and free calendar windows to recommend exercise sessions.',
      requiredActions: [CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList],
      requiredScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    }],
  }
}

function inferMode(action: string): IntegrationRequirementMode {
  if (/(create|send|post|update|delete|write|comment|request)$/i.test(action)) return 'write'
  return 'read'
}

function defaultReason(connectorId: string, mode: IntegrationRequirementMode): string {
  if (connectorId === 'google-calendar' && mode === 'read') return 'Read calendar availability for the generated app.'
  if (connectorId === 'google-calendar' && mode === 'write') return 'Create or update calendar events after user approval.'
  return `${mode === 'read' ? 'Read from' : mode === 'write' ? 'Write to' : 'Subscribe to'} ${connectorId} for this app.`
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
