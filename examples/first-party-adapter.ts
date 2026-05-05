import {
  createConnectorAdapterProvider,
  githubConnector,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '@tangle-network/agent-integrations'

const provider = createConnectorAdapterProvider({
  adapters: [githubConnector],
  resolveDataSource,
})

const connectors = await provider.listConnectors()
console.log(connectors.map((connector) => connector.id))

async function resolveDataSource(connection: IntegrationConnection): Promise<ResolvedDataSource> {
  return {
    id: `source_${connection.id}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind: connection.connectorId,
    label: connection.connectorId,
    consistencyModel: 'authoritative',
    scopes: connection.grantedScopes,
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: process.env.GITHUB_TOKEN ?? '',
    },
    status: 'active',
  }
}
