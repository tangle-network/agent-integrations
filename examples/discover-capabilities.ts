/**
 * Discover the capabilities a workspace can invoke right now.
 *
 * The agent runtime asks the question "what can this workspace do?" and
 * gets back a typed list of MCP-shape tool descriptors gated by the
 * scopes the workspace has granted on each connection.
 */

import {
  discoverWorkspaceCapabilities,
  InMemoryConnectionStore,
  createMockIntegrationProvider,
} from '@tangle-network/agent-integrations'

const owner = { type: 'team' as const, id: 'workspace_acme' }

const store = new InMemoryConnectionStore()
await store.put({
  id: 'conn_gmail',
  owner,
  providerId: 'mock',
  connectorId: 'gmail',
  status: 'active',
  grantedScopes: ['email.read'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const provider = createMockIntegrationProvider()

const discovery = await discoverWorkspaceCapabilities({
  owner,
  store,
  providers: [provider],
  // includeUnconnected: true,  // uncomment to render "connect to unlock" affordances
})

for (const capability of discovery.capabilities) {
  console.log(
    `${capability.id}  risk=${capability.risk}  scopes=${capability.scopes.join(',')}  connected=${capability.connected}`,
  )
}

if (discovery.unreachableConnectors.length > 0) {
  console.warn('Unreachable connectors:', discovery.unreachableConnectors)
}
