import {
  InMemoryConnectionStore,
  IntegrationHub,
  buildIntegrationToolCatalog,
  createMockIntegrationProvider,
  searchIntegrationTools,
} from '@tangle-network/agent-integrations'

const provider = createMockIntegrationProvider()
const store = new InMemoryConnectionStore()
const hub = new IntegrationHub({
  providers: [provider],
  store,
  capabilitySecret: 'replace-with-secret-manager-value',
})

const tools = searchIntegrationTools(
  buildIntegrationToolCatalog(await hub.listConnectors()),
  'email search',
  { maxRisk: 'read' },
)

const connection = await hub.upsertConnection({
  id: 'conn_1',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'mock',
  connectorId: 'gmail',
  status: 'active',
  grantedScopes: ['email.read'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const capability = await hub.issueCapability({
  subject: { type: 'sandbox', id: 'sandbox_1' },
  connectionId: connection.id,
  scopes: ['email.read'],
  allowedActions: [tools[0]!.tool.action.id],
  ttlMs: 60_000,
})

const result = await hub.invokeWithCapability(capability.token, {
  action: tools[0]!.tool.action.id,
  input: { q: 'is:unread' },
})

console.log(result)
