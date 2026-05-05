import { describe, expect, it } from 'vitest'
import {
  createGatewayCatalogProvider,
  InMemoryConnectionStore,
  IntegrationError,
  IntegrationHub,
  normalizeGatewayCatalog,
  type GatewayCatalogEntry,
} from '../src/index'

function gatewayEntries(count: number): GatewayCatalogEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `app-${String(i + 1).padStart(3, '0')}`,
    title: `Gateway App ${i + 1}`,
    category: i % 5 === 0 ? 'crm' : i % 5 === 1 ? 'mail' : i % 5 === 2 ? 'project-management' : i % 5 === 3 ? 'database' : 'support',
    auth: i % 7 === 0 ? 'api-key' : 'oauth2',
    scopes: [`app-${i + 1}.read`, `app-${i + 1}.write`],
    actions: [
      { id: 'search', title: 'Search', risk: 'read', scopes: [`app-${i + 1}.read`] },
      { id: 'upsert', title: 'Upsert', risk: 'write', scopes: [`app-${i + 1}.write`] },
    ],
    triggers: [{ id: 'changed', title: 'Changed', scopes: [`app-${i + 1}.read`] }],
  }))
}

describe('gateway catalog provider', () => {
  it('normalizes a 500+ connector gateway catalog into the standard connector contract', () => {
    const connectors = normalizeGatewayCatalog(gatewayEntries(520), {
      providerId: 'nango',
      providerKind: 'nango',
    })

    expect(connectors).toHaveLength(520)
    expect(connectors[0]).toMatchObject({
      id: 'app-001',
      providerId: 'nango',
      auth: 'api_key',
      category: 'crm',
      metadata: { source: 'gateway-catalog', providerKind: 'nango', executable: true },
    })
    expect(connectors[1]?.category).toBe('email')
    expect(connectors[2]?.category).toBe('workflow')
    expect(connectors.every((connector) => connector.actions.length >= 2)).toBe(true)
  })

  it('plugs gateway-backed connectors into IntegrationHub without vendor-specific product code', async () => {
    const provider = createGatewayCatalogProvider({
      id: 'pipedream',
      kind: 'pipedream',
      fetchCatalog: () => gatewayEntries(3),
      invokeAction: (_connection, request) => ({ ok: true, action: request.action, output: { echoed: request.input } }),
    })
    const hub = new IntegrationHub({
      providers: [provider],
      store: new InMemoryConnectionStore(),
      capabilitySecret: 'secret',
    })

    await hub.upsertConnection({
      id: 'conn-1',
      owner: { type: 'user', id: 'user-1' },
      providerId: 'pipedream',
      connectorId: 'app-001',
      status: 'active',
      grantedScopes: ['app-1.read', 'app-1.write'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    const capability = await hub.issueCapability({
      subject: { type: 'sandbox', id: 'sandbox-1' },
      connectionId: 'conn-1',
      scopes: ['app-1.read'],
      allowedActions: ['search'],
      ttlMs: 60_000,
    })

    const connectors = await hub.listConnectors()
    expect(connectors).toHaveLength(3)

    const result = await hub.invokeWithCapability(capability.token, {
      action: 'search',
      input: { q: 'customer' },
    })
    expect(result).toEqual({ ok: true, action: 'search', output: { echoed: { q: 'customer' } } })
  })

  it('rejects unknown gateway actions before dispatching to the provider', async () => {
    const provider = createGatewayCatalogProvider({
      id: 'activepieces',
      kind: 'activepieces',
      fetchCatalog: () => gatewayEntries(1),
      invokeAction: () => ({ ok: true, action: 'should-not-run' }),
    })

    await expect(provider.invokeAction({
      id: 'conn-1',
      owner: { type: 'user', id: 'user-1' },
      providerId: 'activepieces',
      connectorId: 'app-001',
      status: 'active',
      grantedScopes: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }, {
      connectionId: 'conn-1',
      action: 'missing',
    })).rejects.toMatchObject(new IntegrationError('Action missing is not defined by connector app-001.', 'action_not_found'))
  })
})
