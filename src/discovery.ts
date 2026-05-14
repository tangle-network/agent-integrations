/**
 * Workspace capability discovery — answers "what can this workspace do?"
 * with a typed list of MCP-shape tool descriptors that the agent runtime
 * can flatten into a planner's tool registry.
 *
 * The agent runtime's gating question is one level above the existing
 * connector catalog ("which integrations exist?") and one level below
 * the issued capability-token surface ("temporarily delegate scope X
 * via this signed token"). This module bridges the two:
 *
 *   discoverWorkspaceCapabilities({ owner, connectors, connections, scopes })
 *     → WorkspaceCapability[]
 *
 * A `WorkspaceCapability` is hand-shaped to be cheap to emit alongside a
 * connector manifest and trivial to render into:
 *   - an LLM tool-choice JSON array
 *   - an MCP `tools/list` response
 *   - a UI surface ("Connect Gmail to enable: send_reply, list_messages…")
 *
 * What this is NOT:
 *   - A capability-token issuer. That stays in IntegrationHub.issueCapability.
 *   - A connector registry. That stays in IntegrationRegistry / catalog.
 *
 * Scopes are the load-bearing input: a connector advertises N actions,
 * but only the subset whose `requiredScopes` are a subset of the
 * connection's `grantedScopes` is reachable. The discovery function
 * filters on that automatically.
 *
 * Stability: `@stable` — additions to WorkspaceCapability must be
 * additive and non-breaking.
 */

import type {
  IntegrationActor,
  IntegrationConnection,
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorCategory,
  IntegrationConnectorTrigger,
  IntegrationDataClass,
  IntegrationActionRisk,
  IntegrationConnectionStore,
  IntegrationProvider,
} from './index.js'

/** MCP-shape tool descriptor. Mirrors the
 *  [Model Context Protocol tool schema](https://modelcontextprotocol.io/specification)
 *  closely enough that consumers can pipe a WorkspaceCapability straight
 *  into a `tools/list` response. */
export interface WorkspaceToolSchema {
  name: string
  description?: string
  /** JSON-schema describing the action's input. */
  inputSchema?: unknown
  /** Optional JSON-schema describing the action's output. */
  outputSchema?: unknown
}

/** One discoverable capability — an action a connector exposes that the
 *  workspace has the connection + scopes to invoke. */
export interface WorkspaceCapability {
  /** Stable, fully-qualified id. Format `<connector-id>.<action-id>`. */
  id: string
  /** Human label safe for UI. */
  title: string
  /** Optional one-line description. */
  description?: string
  /** Connector category for grouping. */
  category: IntegrationConnectorCategory
  /** Connector that hosts this capability. */
  connectorId: string
  /** Provider that hosts this connector (first-party, gateway, …). */
  providerId: string
  /** Underlying action id on the connector. */
  actionId: string
  /** Scopes required to invoke. The discovery function only returns
   *  capabilities whose required scopes are a subset of the connection's
   *  grantedScopes. */
  scopes: string[]
  /** Risk class — useful for UI ("write" / "destructive" lights). */
  risk: IntegrationActionRisk
  /** Data class of the action's output, when known. */
  dataClass: IntegrationDataClass
  /** MCP-shape tool schema the agent runtime can register directly. */
  toolSchema: WorkspaceToolSchema
  /** True iff the workspace has an active connection backing this
   *  capability. False capabilities (advertised by the connector but
   *  not yet connected) are included when `includeUnconnected: true`
   *  is passed — useful for "connect to unlock" UI affordances. */
  connected: boolean
  /** Connection id backing this capability. Undefined when
   *  `connected: false`. */
  connectionId?: string
  /** Whether the action requires explicit approval before invocation. */
  approvalRequired?: boolean
}

/** Optional inbound trigger surface. Same shape as a capability so the
 *  consumer can render both with one component. */
export interface WorkspaceTrigger {
  id: string
  title: string
  description?: string
  category: IntegrationConnectorCategory
  connectorId: string
  providerId: string
  triggerId: string
  scopes: string[]
  dataClass: IntegrationDataClass
  connected: boolean
  connectionId?: string
}

export interface DiscoverWorkspaceCapabilitiesInput {
  /** Workspace owner. Used to scope the connection lookup when `store`
   *  is supplied (the canonical production path). */
  owner: IntegrationActor
  /** Either an explicit connection list (test/fixture path) or a store
   *  the function should query for connections by owner. Exactly one
   *  of `connections` / `store` MUST be provided. */
  connections?: IntegrationConnection[]
  store?: IntegrationConnectionStore
  /** Either an explicit connector list (test/fixture path) or a set of
   *  providers the function should query via `listConnectors()`. */
  connectors?: IntegrationConnector[]
  providers?: IntegrationProvider[]
  /** Include capabilities whose connector is in the catalog but the
   *  workspace has no active connection for. Useful to render
   *  "connect to unlock" affordances. Default: false. */
  includeUnconnected?: boolean
  /** When true, include capabilities even if some required scopes are
   *  missing from the connection grant. The default `false` hides such
   *  capabilities — the agent runtime never sees them. */
  includeMissingScopes?: boolean
}

export interface WorkspaceCapabilityDiscovery {
  capabilities: WorkspaceCapability[]
  triggers: WorkspaceTrigger[]
  /** Counts grouped by connector for telemetry / UI badges. */
  countsByConnector: Record<string, number>
  /** Connectors the workspace is connected to but the planner cannot
   *  reach any actions on (e.g., zero scopes granted, or all actions
   *  require an additional scope). */
  unreachableConnectors: Array<{ connectorId: string; reason: string }>
}

/** Resolve workspace-visible capabilities + triggers. Pure with respect
 *  to the inputs — caller decides whether to back `connections` and
 *  `connectors` with persistent state or static fixtures. */
export async function discoverWorkspaceCapabilities(
  input: DiscoverWorkspaceCapabilitiesInput,
): Promise<WorkspaceCapabilityDiscovery> {
  const connections = await resolveConnections(input)
  const connectors = await resolveConnectors(input)
  const activeConnectionsByConnector = new Map<string, IntegrationConnection>()
  for (const conn of connections) {
    if (conn.status !== 'active') continue
    if (!activeConnectionsByConnector.has(conn.connectorId)) {
      activeConnectionsByConnector.set(conn.connectorId, conn)
    }
  }

  const capabilities: WorkspaceCapability[] = []
  const triggers: WorkspaceTrigger[] = []
  const countsByConnector: Record<string, number> = {}
  const unreachableConnectors: Array<{ connectorId: string; reason: string }> = []

  for (const connector of connectors) {
    const connection = activeConnectionsByConnector.get(connector.id)
    const connected = Boolean(connection)
    if (!connected && !input.includeUnconnected) continue

    const grantedScopes = new Set(connection?.grantedScopes ?? [])
    let actionsAdded = 0

    for (const action of connector.actions) {
      const missing = action.requiredScopes.filter((scope) => !grantedScopes.has(scope))
      if (connected && missing.length > 0 && !input.includeMissingScopes) continue
      capabilities.push(toCapability(connector, action, connection))
      actionsAdded += 1
    }
    for (const trigger of connector.triggers ?? []) {
      const missing = trigger.requiredScopes.filter((scope) => !grantedScopes.has(scope))
      if (connected && missing.length > 0 && !input.includeMissingScopes) continue
      triggers.push(toTrigger(connector, trigger, connection))
    }

    countsByConnector[connector.id] = actionsAdded
    if (connected && actionsAdded === 0 && connector.actions.length > 0) {
      unreachableConnectors.push({
        connectorId: connector.id,
        reason: 'all_actions_missing_scope',
      })
    }
  }

  return { capabilities, triggers, countsByConnector, unreachableConnectors }
}

async function resolveConnections(input: DiscoverWorkspaceCapabilitiesInput): Promise<IntegrationConnection[]> {
  if (input.connections) return input.connections
  if (input.store) return await input.store.listByOwner(input.owner)
  throw new Error('discoverWorkspaceCapabilities: provide either connections or store')
}

async function resolveConnectors(input: DiscoverWorkspaceCapabilitiesInput): Promise<IntegrationConnector[]> {
  if (input.connectors) return input.connectors
  if (input.providers) {
    const lists = await Promise.all(input.providers.map((p) => Promise.resolve(p.listConnectors())))
    return lists.flat()
  }
  throw new Error('discoverWorkspaceCapabilities: provide either connectors or providers')
}

function toCapability(
  connector: IntegrationConnector,
  action: IntegrationConnectorAction,
  connection: IntegrationConnection | undefined,
): WorkspaceCapability {
  return {
    id: `${connector.id}.${action.id}`,
    title: action.title,
    description: action.description,
    category: connector.category,
    connectorId: connector.id,
    providerId: connector.providerId,
    actionId: action.id,
    scopes: action.requiredScopes,
    risk: action.risk,
    dataClass: action.dataClass,
    toolSchema: {
      name: `${connector.id}.${action.id}`,
      description: action.description,
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
    },
    connected: Boolean(connection),
    connectionId: connection?.id,
    approvalRequired: action.approvalRequired,
  }
}

function toTrigger(
  connector: IntegrationConnector,
  trigger: IntegrationConnectorTrigger,
  connection: IntegrationConnection | undefined,
): WorkspaceTrigger {
  return {
    id: `${connector.id}.${trigger.id}`,
    title: trigger.title,
    description: trigger.description,
    category: connector.category,
    connectorId: connector.id,
    providerId: connector.providerId,
    triggerId: trigger.id,
    scopes: trigger.requiredScopes,
    dataClass: trigger.dataClass,
    connected: Boolean(connection),
    connectionId: connection?.id,
  }
}

/**
 * Filter a {@link WorkspaceCapabilityDiscovery} result by the calling
 * user's effective id.tangle.tools workspace scopes. Pair with the
 * `tangleIdentity()` adapter's `list_workspaces` / `switch_workspace`
 * output to keep what the agent runtime sees aligned with what the
 * workspace's plan actually permits.
 *
 * Semantics:
 *   - Every workspace scope is matched against every capability's
 *     `scopes` list. Wildcard scopes (`tangle:*`, `<connectorId>:*`) are
 *     respected — a workspace with `tangle:*` sees everything; a
 *     workspace with `gmail:*` sees every gmail capability regardless of
 *     the upstream OAuth scope.
 *   - When `workspaceScopes` is empty, returns the discovery as-is (no
 *     workspace gate). Pass an explicit `denyByDefault: true` to flip
 *     that to "empty workspace sees nothing" — matches the platform's
 *     fail-closed posture for production tenants.
 *
 * Pure with respect to the inputs — no side effects.
 */
export function filterDiscoveryByWorkspaceScopes(
  discovery: WorkspaceCapabilityDiscovery,
  workspaceScopes: string[],
  opts: { denyByDefault?: boolean } = {},
): WorkspaceCapabilityDiscovery {
  if (workspaceScopes.length === 0 && !opts.denyByDefault) return discovery
  const granted = new Set(workspaceScopes)
  const hasWildcard = granted.has('tangle:*')

  function allowed(connectorId: string, scopes: string[]): boolean {
    if (hasWildcard) return true
    if (granted.has(`${connectorId}:*`)) return true
    // A workspace scope satisfies the capability iff every required
    // upstream scope is also present, OR the workspace explicitly
    // grants the connector. We deliberately do NOT loosen this to
    // "any granted scope intersects" — that would let a tenant with
    // a read-only Gmail grant invoke send_reply by accident.
    for (const scope of scopes) {
      if (!granted.has(scope)) return false
    }
    return true
  }

  const capabilities = discovery.capabilities.filter((cap) => allowed(cap.connectorId, cap.scopes))
  const triggers = discovery.triggers.filter((t) => allowed(t.connectorId, t.scopes))
  const countsByConnector: Record<string, number> = {}
  for (const cap of capabilities) {
    countsByConnector[cap.connectorId] = (countsByConnector[cap.connectorId] ?? 0) + 1
  }
  return {
    capabilities,
    triggers,
    countsByConnector,
    unreachableConnectors: discovery.unreachableConnectors,
  }
}
