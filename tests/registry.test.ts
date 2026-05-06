import { describe, expect, it } from 'vitest'
import {
  buildDefaultIntegrationRegistry,
  buildIntegrationToolCatalog,
  canonicalConnectorId,
  composeIntegrationRegistry,
  createConnectorAdapterCatalogSource,
  createMockIntegrationProvider,
  googleCalendar,
  InMemoryConnectionStore,
  IntegrationHub,
  searchIntegrationTools,
  summarizeIntegrationRegistry,
  type IntegrationConnector,
} from '../src/index'

describe('integration registry', () => {
  it('deduplicates broad catalogs into one canonical connector per integration', () => {
    const registry = buildDefaultIntegrationRegistry()
    const ids = registry.connectors.map((connector) => connector.id)
    const slack = registry.byId.get('slack')

    expect(registry.entries.length).toBeGreaterThanOrEqual(650)
    expect(new Set(ids).size).toBe(ids.length)
    expect(slack?.canonicalId).toBe('slack')
    expect(slack?.supportTier).toBe('setupReady')
    expect(slack?.sources.map((source) => source.sourceId)).toEqual(expect.arrayContaining(['spec', 'tangle-catalog']))
    expect(slack?.connector.actions.some((action) => action.id === 'messages.post')).toBe(true)
    expect(slack?.connector.actions.some((action) => action.id.includes('send.message'))).toBe(false)
    expect(slack?.connector.metadata?.registry).toMatchObject({
      toolBindable: true,
    })
    expect(JSON.stringify(slack?.connector)).not.toContain('activepieces')
  })

  it('can treat the full Tangle catalog runtime as executable for product registries', () => {
    const registry = buildDefaultIntegrationRegistry({ tangleCatalogRuntimeExecutable: true })
    const gmail = registry.byId.get('gmail')
    const tools = buildIntegrationToolCatalog(registry.connectors)
    const results = searchIntegrationTools(tools, 'search gmail mail', { maxRisk: 'read' })

    expect(gmail?.supportTier).toBe('gatewayExecutable')
    expect(gmail?.connector.metadata?.registry).toMatchObject({
      supportTier: 'gatewayExecutable',
      toolBindable: true,
    })
    expect(gmail?.connector.actions.some((action) => action.id === 'gmail.search.mail')).toBe(true)
    expect(results.some((result) => result.tool.connectorId === 'gmail')).toBe(true)
  })

  it('surfaces catalog conflicts instead of hiding mismatched facts', () => {
    const registry = buildDefaultIntegrationRegistry()
    const github = registry.byId.get('github')

    expect(github?.conflicts.some((conflict) => conflict.field === 'auth')).toBe(true)
    expect(github?.connector.metadata?.registry).toMatchObject({
      canonicalId: 'github',
      supportTier: 'setupReady',
    })
  })

  it('resolves aliases to a canonical entry without losing lookup ergonomics', () => {
    const registry = buildDefaultIntegrationRegistry()
    const canonical = registry.byId.get('notion-database')
    const alias = registry.byId.get('notion')

    expect(canonical).toBeDefined()
    expect(alias).toBe(canonical)
    expect(canonical?.aliases).toContain('notion')
    expect(canonical?.connector.id).toBe('notion-database')
  })

  it('lets executable first-party connectors win without exposing catalog-only actions as tools', () => {
    const firstParty = connector({
      id: 'gmail',
      providerId: 'first-party',
      actions: [{ id: 'messages.send', title: 'Send message', risk: 'write' }],
      metadata: { source: 'first-party-adapter', executable: true },
    })
    const catalog = connector({
      id: 'gmail',
      providerId: 'activepieces',
      actions: [{ id: 'messages.search', title: 'Search messages', risk: 'read' }],
      metadata: { source: 'activepieces-community', catalogOnly: true },
    })

    const registry = composeIntegrationRegistry([
      { id: 'activepieces', connectors: [catalog] },
      { id: 'first-party', connectors: [firstParty] },
    ])
    const gmail = registry.byId.get('gmail')

    expect(gmail?.supportTier).toBe('firstPartyExecutable')
    expect(gmail?.connector.providerId).toBe('first-party')
    expect(gmail?.connector.actions.map((action) => action.id).sort()).toEqual(['messages.send'])
    expect(gmail?.connector.metadata?.registry).toMatchObject({
      catalogOnlyActionCount: 1,
      toolBindable: true,
    })
  })

  it('composes real adapter manifests into registry sources without runtime credentials in the default registry', () => {
    const adapterSource = createConnectorAdapterCatalogSource({
      adapters: [googleCalendar({ clientId: 'test-client', clientSecret: 'test-secret' })],
    })
    const registry = composeIntegrationRegistry([
      adapterSource,
      ...[buildDefaultIntegrationRegistry({ includeTangleCatalog: false })].map((base) => ({
        id: 'spec',
        connectors: base.connectors,
      })),
    ])
    const calendar = registry.byId.get('google-calendar')

    expect(calendar?.supportTier).toBe('firstPartyExecutable')
    expect(calendar?.connector.providerId).toBe('first-party')
    expect(calendar?.sources.map((source) => source.sourceId)).toEqual(expect.arrayContaining(['first-party', 'spec']))
    expect(calendar?.connector.actions.map((action) => action.id).sort()).toEqual(['book_slot', 'list_availability'])
  })

  it('keeps pure catalog-only connectors discoverable but not tool-bindable', () => {
    const registry = composeIntegrationRegistry([
      {
        id: 'activepieces',
        connectors: [connector({
          id: 'long-tail',
          providerId: 'activepieces',
          actions: [{ id: 'records.upsert', title: 'Upsert record', risk: 'write' }],
          metadata: { source: 'activepieces-community', catalogOnly: true },
        })],
      },
    ])
    const entry = registry.byId.get('long-tail')

    expect(entry?.supportTier).toBe('catalogOnly')
    expect(entry?.connector.actions).toEqual([])
    expect(entry?.connector.metadata?.registry).toMatchObject({
      catalogOnlyActionCount: 1,
      toolBindable: false,
    })
  })

  it('feeds the existing tool search path from the deduplicated registry', () => {
    const registry = buildDefaultIntegrationRegistry()
    const tools = buildIntegrationToolCatalog(registry.connectors)
    const results = searchIntegrationTools(tools, 'send a slack message', { maxRisk: 'write' })

    expect(results[0].tool.connectorId).toBe('slack')
  })

  it('lets IntegrationHub expose a deduplicated registry over provider catalogs', async () => {
    const hub = new IntegrationHub({
      providers: [
        createMockIntegrationProvider({
          id: 'catalog',
          connectors: [connector({
            id: 'gmail',
            providerId: 'catalog',
            actions: [{ id: 'messages.search', title: 'Search messages', risk: 'read' }],
            metadata: { source: 'activepieces-community', catalogOnly: true },
          })],
        }),
        createMockIntegrationProvider({
          id: 'first-party',
          connectors: [connector({
            id: 'gmail',
            providerId: 'first-party',
            actions: [{ id: 'messages.send', title: 'Send message', risk: 'write' }],
            metadata: { source: 'first-party-adapter', executable: true },
          })],
        }),
      ],
      store: new InMemoryConnectionStore(),
      capabilitySecret: 'x'.repeat(32),
    })

    const flat = await hub.listConnectors()
    const registry = await hub.listRegistry()

    expect(flat).toHaveLength(2)
    expect(registry.connectors).toHaveLength(1)
    expect(registry.byId.get('gmail')?.supportTier).toBe('firstPartyExecutable')
  })

  it('normalizes common provider aliases deterministically', () => {
    expect(canonicalConnectorId('Outlook Calendar')).toBe('microsoft-calendar')
    expect(canonicalConnectorId('notion')).toBe('notion-database')
    expect(canonicalConnectorId('stripe')).toBe('stripe-pack')
  })

  it('summarizes support tiers and conflict load for admin surfaces', () => {
    const summary = summarizeIntegrationRegistry(buildDefaultIntegrationRegistry())

    expect(summary.totalEntries).toBeGreaterThanOrEqual(650)
    expect(summary.bySupportTier.catalogOnly).toBeGreaterThan(500)
    expect(summary.bySupportTier.setupReady).toBeGreaterThanOrEqual(100)
    expect(summary.toolBindableEntries).toBeLessThan(summary.totalEntries)
    expect(summary.conflictEntries).toBeGreaterThan(0)
  })
})

function connector(options: {
  id: string
  providerId: string
  actions: Array<{ id: string; title: string; risk: 'read' | 'write' | 'destructive' }>
  metadata?: Record<string, unknown>
}): IntegrationConnector {
  return {
    id: options.id,
    providerId: options.providerId,
    title: options.id,
    category: 'email',
    auth: 'oauth2',
    scopes: [`${options.id}.read`, `${options.id}.write`],
    actions: options.actions.map((action) => ({
      ...action,
      requiredScopes: [action.risk === 'read' ? `${options.id}.read` : `${options.id}.write`],
      dataClass: 'private',
    })),
    metadata: options.metadata,
  }
}
