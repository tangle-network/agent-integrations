import type {
  IntegrationActor,
  IntegrationTriggerEvent,
  IntegrationTriggerSubscription,
} from './index.js'
import {
  type IntegrationGrant,
  type IntegrationGrantStore,
  type IntegrationManifest,
  type IntegrationRuntime,
} from './runtime.js'

export interface IntegrationWorkflowDefinition {
  id: string
  title?: string
  manifest: IntegrationManifest
  trigger: {
    requirementId: string
    triggerId: string
    targetUrl?: string
  }
  metadata?: Record<string, unknown>
}

export interface InstalledIntegrationWorkflow {
  id: string
  workflowId: string
  manifestId: string
  owner: IntegrationActor
  grantee: IntegrationActor
  triggerGrantId: string
  subscription: IntegrationTriggerSubscription
  status: 'active' | 'paused' | 'error'
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface IntegrationWorkflowStore {
  put(workflow: InstalledIntegrationWorkflow): Promise<void> | void
  get(id: string): Promise<InstalledIntegrationWorkflow | undefined> | InstalledIntegrationWorkflow | undefined
  list(): Promise<InstalledIntegrationWorkflow[]> | InstalledIntegrationWorkflow[]
  listByWorkflow(workflowId: string): Promise<InstalledIntegrationWorkflow[]> | InstalledIntegrationWorkflow[]
  listByOwner(owner: IntegrationActor): Promise<InstalledIntegrationWorkflow[]> | InstalledIntegrationWorkflow[]
}

export interface IntegrationWorkflowRuntimeHub {
  subscribeTrigger(connectionId: string, trigger: string, targetUrl?: string): Promise<IntegrationTriggerSubscription> | IntegrationTriggerSubscription
}

export interface IntegrationWorkflowRuntimeOptions {
  runtime: IntegrationRuntime
  hub: IntegrationWorkflowRuntimeHub
  grants: IntegrationGrantStore
  store?: IntegrationWorkflowStore
  now?: () => Date
}

export class InMemoryIntegrationWorkflowStore implements IntegrationWorkflowStore {
  private readonly workflows = new Map<string, InstalledIntegrationWorkflow>()

  put(workflow: InstalledIntegrationWorkflow): void {
    this.workflows.set(workflow.id, workflow)
  }

  get(id: string): InstalledIntegrationWorkflow | undefined {
    return this.workflows.get(id)
  }

  list(): InstalledIntegrationWorkflow[] {
    return [...this.workflows.values()]
  }

  listByWorkflow(workflowId: string): InstalledIntegrationWorkflow[] {
    return [...this.workflows.values()].filter((workflow) => workflow.workflowId === workflowId)
  }

  listByOwner(owner: IntegrationActor): InstalledIntegrationWorkflow[] {
    return [...this.workflows.values()].filter((workflow) => sameActor(workflow.owner, owner))
  }
}

export class IntegrationWorkflowRuntime {
  private readonly runtime: IntegrationRuntime
  private readonly hub: IntegrationWorkflowRuntimeHub
  private readonly grants: IntegrationGrantStore
  private readonly store: IntegrationWorkflowStore
  private readonly now: () => Date

  constructor(options: IntegrationWorkflowRuntimeOptions) {
    this.runtime = options.runtime
    this.hub = options.hub
    this.grants = options.grants
    this.store = options.store ?? new InMemoryIntegrationWorkflowStore()
    this.now = options.now ?? (() => new Date())
  }

  async install(input: {
    workflow: IntegrationWorkflowDefinition
    owner: IntegrationActor
    grantee: IntegrationActor
  }): Promise<InstalledIntegrationWorkflow> {
    const grants = await this.runtime.createGrants({
      manifest: input.workflow.manifest,
      owner: input.owner,
      grantee: input.grantee,
      metadata: { workflowId: input.workflow.id },
    })
    const triggerGrant = findTriggerGrant(grants, input.workflow.trigger.requirementId, input.workflow.trigger.triggerId)
    const subscription = await this.hub.subscribeTrigger(
      triggerGrant.connectionId,
      input.workflow.trigger.triggerId,
      input.workflow.trigger.targetUrl,
    )
    const installed: InstalledIntegrationWorkflow = {
      id: `workflow_${input.workflow.id}_${triggerGrant.id}`,
      workflowId: input.workflow.id,
      manifestId: input.workflow.manifest.id,
      owner: input.owner,
      grantee: input.grantee,
      triggerGrantId: triggerGrant.id,
      subscription,
      status: 'active',
      createdAt: this.now().toISOString(),
      metadata: input.workflow.metadata,
    }
    await this.store.put(installed)
    return installed
  }

  async dispatchEvent<T = unknown>(
    event: IntegrationTriggerEvent<T>,
    handler: (input: { event: IntegrationTriggerEvent<T>; workflows: InstalledIntegrationWorkflow[] }) => Promise<void> | void,
  ): Promise<{ matched: InstalledIntegrationWorkflow[] }> {
    // A workflow outlives its installation-time grant. Recheck the current
    // grant before routing a new event; an active subscription is not authority.
    // This assumes verified ingress. Deferred effects must recheck authority
    // again at execution time rather than treating this snapshot as a lease.
    const candidates = (await this.store.list()).filter((workflow) =>
      workflow.status === 'active'
      && workflow.subscription.status === 'active'
      && workflow.subscription.connectionId === event.connectionId
      && workflow.subscription.trigger === event.trigger
    )
    // One batched read keeps webhook latency flat as a trigger fans out to
    // many workflows backed by a remote grant store.
    const grantIds = [...new Set(candidates.map((workflow) => workflow.triggerGrantId))]
    const grants = grantIds.length === 0
      ? []
      : this.grants.listByIds
        ? await this.grants.listByIds(grantIds)
        : await Promise.all(grantIds.map((grantId) => this.grants.get(grantId)))
    const grantsById = new Map(
      grants
        .filter((grant): grant is IntegrationGrant => Boolean(grant))
        .map((grant) => [grant.id, grant]),
    )
    const workflows = candidates.filter((workflow) => {
      const grant = grantsById.get(workflow.triggerGrantId)
      if (!grant) return false
      return grant.status === 'active'
        && grant.manifestId === workflow.manifestId
        && sameActor(grant.owner, workflow.owner)
        && sameActor(grant.grantee, workflow.grantee)
        && grant.connectionId === event.connectionId
        && grant.connectorId === event.connectorId
        && grant.allowedTriggers.includes(event.trigger)
    })
    await handler({ event, workflows })
    return { matched: workflows }
  }
}

export function createIntegrationWorkflowRuntime(options: IntegrationWorkflowRuntimeOptions): IntegrationWorkflowRuntime {
  return new IntegrationWorkflowRuntime(options)
}

function findTriggerGrant(grants: IntegrationGrant[], requirementId: string, triggerId: string): IntegrationGrant {
  const grant = grants.find((candidate) =>
    candidate.requirementId === requirementId && candidate.allowedTriggers.includes(triggerId)
  )
  if (!grant) throw new Error(`Missing trigger grant ${requirementId}/${triggerId}.`)
  return grant
}

function sameActor(a: IntegrationActor, b: IntegrationActor): boolean {
  return a.type === b.type && a.id === b.id
}
