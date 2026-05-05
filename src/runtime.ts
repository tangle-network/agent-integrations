import {
  buildIntegrationToolCatalog,
  type IntegrationToolDefinition,
} from './catalog.js'
import type {
  IntegrationActor,
  IntegrationConnection,
  IntegrationConnector,
  IssuedIntegrationCapability,
} from './index.js'
import type {
  IntegrationRegistry,
  IntegrationRegistryEntry,
} from './registry.js'

export type IntegrationRequirementMode = 'read' | 'write' | 'trigger'
export type IntegrationRequirementStatus = 'ready' | 'missing_connection' | 'not_executable' | 'unknown_connector'

export interface IntegrationRequirement {
  id: string
  connectorId: string
  reason: string
  mode: IntegrationRequirementMode
  requiredActions?: string[]
  requiredTriggers?: string[]
  requiredScopes?: string[]
  optional?: boolean
}

export interface IntegrationManifest {
  id: string
  title?: string
  owner?: IntegrationActor
  requirements: IntegrationRequirement[]
  metadata?: Record<string, unknown>
}

export interface IntegrationRequirementResolution {
  requirement: IntegrationRequirement
  status: IntegrationRequirementStatus
  connector?: IntegrationConnector
  registryEntry?: IntegrationRegistryEntry
  connection?: IntegrationConnection
  missingScopes: string[]
  missingActions: string[]
  missingTriggers: string[]
  message: string
}

export interface IntegrationManifestResolution {
  manifest: IntegrationManifest
  owner: IntegrationActor
  ready: IntegrationRequirementResolution[]
  missing: IntegrationRequirementResolution[]
  optionalMissing: IntegrationRequirementResolution[]
}

export interface IntegrationGrant {
  id: string
  manifestId: string
  requirementId: string
  owner: IntegrationActor
  grantee: IntegrationActor
  connectionId: string
  connectorId: string
  scopes: string[]
  allowedActions: string[]
  allowedTriggers: string[]
  status: 'active' | 'revoked'
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
}

export interface IntegrationGrantStore {
  get(grantId: string): Promise<IntegrationGrant | undefined> | IntegrationGrant | undefined
  put(grant: IntegrationGrant): Promise<void> | void
  listByManifest(manifestId: string, grantee?: IntegrationActor): Promise<IntegrationGrant[]> | IntegrationGrant[]
  listByGrantee(grantee: IntegrationActor): Promise<IntegrationGrant[]> | IntegrationGrant[]
  delete?(grantId: string): Promise<void> | void
}

export interface IntegrationCapabilityBinding {
  requirementId: string
  connectorId: string
  connectionId: string
  grantId: string
  scopes: string[]
  allowedActions: string[]
  allowedTriggers: string[]
  capability: IssuedIntegrationCapability
}

export interface IntegrationSandboxBundle {
  manifestId: string
  subject: IntegrationActor
  capabilities: IntegrationCapabilityBinding[]
  connectors: IntegrationConnector[]
  tools: IntegrationToolDefinition[]
  expiresAt: string
}

export interface IntegrationRuntimeHub {
  listRegistry(): Promise<IntegrationRegistry> | IntegrationRegistry
  listConnections(owner: IntegrationActor): Promise<IntegrationConnection[]> | IntegrationConnection[]
  issueCapability(input: {
    subject: IntegrationActor
    connectionId: string
    scopes: string[]
    allowedActions: string[]
    ttlMs: number
    metadata?: Record<string, unknown>
  }): Promise<IssuedIntegrationCapability> | IssuedIntegrationCapability
}

export interface IntegrationRuntimeOptions {
  hub: IntegrationRuntimeHub
  grants?: IntegrationGrantStore
  now?: () => Date
}

export class InMemoryIntegrationGrantStore implements IntegrationGrantStore {
  private readonly grants = new Map<string, IntegrationGrant>()

  get(grantId: string): IntegrationGrant | undefined {
    return this.grants.get(grantId)
  }

  put(grant: IntegrationGrant): void {
    this.grants.set(grant.id, grant)
  }

  listByManifest(manifestId: string, grantee?: IntegrationActor): IntegrationGrant[] {
    return [...this.grants.values()].filter((grant) =>
      grant.manifestId === manifestId && (!grantee || sameActor(grant.grantee, grantee))
    )
  }

  listByGrantee(grantee: IntegrationActor): IntegrationGrant[] {
    return [...this.grants.values()].filter((grant) => sameActor(grant.grantee, grantee))
  }

  delete(grantId: string): void {
    this.grants.delete(grantId)
  }
}

export class IntegrationRuntime {
  private readonly hub: IntegrationRuntimeHub
  private readonly grants: IntegrationGrantStore
  private readonly now: () => Date

  constructor(options: IntegrationRuntimeOptions) {
    this.hub = options.hub
    this.grants = options.grants ?? new InMemoryIntegrationGrantStore()
    this.now = options.now ?? (() => new Date())
  }

  async registry(): Promise<IntegrationRegistry> {
    return this.hub.listRegistry()
  }

  async resolveManifest(manifest: IntegrationManifest, owner: IntegrationActor): Promise<IntegrationManifestResolution> {
    const registry = await this.registry()
    const connections = await this.hub.listConnections(owner)
    const resolutions = manifest.requirements.map((requirement) =>
      resolveRequirement(requirement, owner, registry, connections),
    )
    return {
      manifest,
      owner,
      ready: resolutions.filter((resolution) => resolution.status === 'ready'),
      missing: resolutions.filter((resolution) => resolution.status !== 'ready' && !resolution.requirement.optional),
      optionalMissing: resolutions.filter((resolution) => resolution.status !== 'ready' && resolution.requirement.optional === true),
    }
  }

  async createGrants(input: {
    manifest: IntegrationManifest
    owner: IntegrationActor
    grantee: IntegrationActor
    metadata?: Record<string, unknown>
  }): Promise<IntegrationGrant[]> {
    const resolution = await this.resolveManifest(input.manifest, input.owner)
    if (resolution.missing.length > 0) {
      throw new Error(`Cannot create integration grants; missing requirements: ${resolution.missing.map((r) => r.requirement.id).join(', ')}`)
    }
    const now = this.now().toISOString()
    const grants = resolution.ready.map((ready): IntegrationGrant => ({
      id: `grant_${input.manifest.id}_${ready.requirement.id}_${ready.connection!.id}`,
      manifestId: input.manifest.id,
      requirementId: ready.requirement.id,
      owner: input.owner,
      grantee: input.grantee,
      connectionId: ready.connection!.id,
      connectorId: ready.connector!.id,
      scopes: requiredScopes(ready.requirement, ready.connector!),
      allowedActions: requiredActions(ready.requirement, ready.connector!),
      allowedTriggers: requiredTriggers(ready.requirement, ready.connector!),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    }))
    for (const grant of grants) await this.grants.put(grant)
    return grants
  }

  async buildSandboxBundle(input: {
    manifestId: string
    subject: IntegrationActor
    ttlMs: number
    grantee?: IntegrationActor
  }): Promise<IntegrationSandboxBundle> {
    const grants = (await this.grants.listByManifest(input.manifestId, input.grantee))
      .filter((grant) => grant.status === 'active')
    const registry = await this.registry()
    const bindings: IntegrationCapabilityBinding[] = []
    const connectors: IntegrationConnector[] = []
    let expiresAt = ''

    for (const grant of grants) {
      const entry = registry.byId.get(grant.connectorId)
      if (!entry) continue
      const connector = {
        ...entry.connector,
        actions: entry.connector.actions.filter((action) => grant.allowedActions.includes(action.id)),
        triggers: entry.connector.triggers?.filter((trigger) => grant.allowedTriggers.includes(trigger.id)),
        scopes: entry.connector.scopes.filter((scope) => grant.scopes.includes(scope)),
      }
      const capability = await this.hub.issueCapability({
        subject: input.subject,
        connectionId: grant.connectionId,
        scopes: grant.scopes,
        allowedActions: grant.allowedActions,
        ttlMs: input.ttlMs,
        metadata: {
          manifestId: grant.manifestId,
          grantId: grant.id,
          requirementId: grant.requirementId,
        },
      })
      bindings.push({
        requirementId: grant.requirementId,
        connectorId: grant.connectorId,
        connectionId: grant.connectionId,
        grantId: grant.id,
        scopes: grant.scopes,
        allowedActions: grant.allowedActions,
        allowedTriggers: grant.allowedTriggers,
        capability,
      })
      connectors.push(connector)
      expiresAt = capability.capability.expiresAt
    }

    return {
      manifestId: input.manifestId,
      subject: input.subject,
      capabilities: bindings,
      connectors,
      tools: buildIntegrationToolCatalog(connectors),
      expiresAt,
    }
  }
}

export function createIntegrationRuntime(options: IntegrationRuntimeOptions): IntegrationRuntime {
  return new IntegrationRuntime(options)
}

function resolveRequirement(
  requirement: IntegrationRequirement,
  owner: IntegrationActor,
  registry: IntegrationRegistry,
  connections: IntegrationConnection[],
): IntegrationRequirementResolution {
  const entry = registry.byId.get(requirement.connectorId)
  if (!entry) {
    return missing(requirement, 'unknown_connector', `Unknown connector ${requirement.connectorId}.`)
  }
  const connector = entry.connector
  if (connector.actions.length === 0 && (connector.triggers?.length ?? 0) === 0) {
    return missing(requirement, 'not_executable', `${connector.title} is catalog-only and cannot be invoked yet.`, connector, entry)
  }
  const scopes = requiredScopes(requirement, connector)
  const actions = requiredActions(requirement, connector)
  const triggers = requiredTriggers(requirement, connector)
  const connection = connections.find((candidate) =>
    sameActor(candidate.owner, owner)
    && candidate.status === 'active'
    && (candidate.connectorId === connector.id || entry.aliases.includes(candidate.connectorId))
    && scopes.every((scope) => candidate.grantedScopes.includes(scope))
  )
  if (!connection) {
    return {
      requirement,
      status: 'missing_connection',
      connector,
      registryEntry: entry,
      missingScopes: scopes,
      missingActions: actions,
      missingTriggers: triggers,
      message: `${connector.title} needs an active user connection with the required scopes.`,
    }
  }
  return {
    requirement,
    status: 'ready',
    connector,
    registryEntry: entry,
    connection,
    missingScopes: [],
    missingActions: [],
    missingTriggers: [],
    message: `${connector.title} is ready.`,
  }
}

function missing(
  requirement: IntegrationRequirement,
  status: Exclude<IntegrationRequirementStatus, 'ready' | 'missing_connection'>,
  message: string,
  connector?: IntegrationConnector,
  registryEntry?: IntegrationRegistryEntry,
): IntegrationRequirementResolution {
  return {
    requirement,
    status,
    connector,
    registryEntry,
    missingScopes: [],
    missingActions: [],
    missingTriggers: [],
    message,
  }
}

function requiredActions(requirement: IntegrationRequirement, connector: IntegrationConnector): string[] {
  if (requirement.mode === 'trigger') return []
  if (requirement.requiredActions?.length) return unique(requirement.requiredActions)
  const actions = connector.actions.filter((action) => {
    if (requirement.mode === 'read') return action.risk === 'read'
    if (requirement.mode === 'write') return action.risk !== 'read'
    return false
  })
  return unique(actions.map((action) => action.id))
}

function requiredTriggers(requirement: IntegrationRequirement, connector: IntegrationConnector): string[] {
  if (requirement.requiredTriggers?.length) return unique(requirement.requiredTriggers)
  if (requirement.mode !== 'trigger') return []
  return unique((connector.triggers ?? []).map((trigger) => trigger.id))
}

function requiredScopes(requirement: IntegrationRequirement, connector: IntegrationConnector): string[] {
  if (requirement.requiredScopes?.length) return unique(requirement.requiredScopes)
  const actionIds = new Set(requiredActions(requirement, connector))
  const triggerIds = new Set(requiredTriggers(requirement, connector))
  return unique([
    ...connector.actions
      .filter((action) => actionIds.has(action.id))
      .flatMap((action) => action.requiredScopes),
    ...(connector.triggers ?? [])
      .filter((trigger) => triggerIds.has(trigger.id))
      .flatMap((trigger) => trigger.requiredScopes),
  ])
}

function sameActor(a: IntegrationActor, b: IntegrationActor): boolean {
  return a.type === b.type && a.id === b.id
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
