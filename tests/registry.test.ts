import { describe, expect, it } from 'vitest'
import {
  buildDefaultIntegrationRegistry,
  buildIntegrationToolCatalog,
  canonicalConnectorId,
  composeIntegrationRegistry,
  createMockIntegrationProvider,
  InMemoryConnectionStore,
  IntegrationHub,
  searchIntegrationTools,
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
    expect(slack?.sources.map((source) => source.sourceId)).toEqual(expect.arrayContaining(['spec', 'activepieces']))
    expect(slack?.connector.actions.some((action) => action.id === 'messages.post')).toBe(true)
    expect(slack?.connector.actions.some((action) => action.id.includes('send.message'))).toBe(true)
  })

  it('surfaces catalog conflicts instead of hiding mismatched facts', () => {
    const registry = buildDefaultIntegrationRegistry()
    const github = registry.byId.get('github')

    expect(github?.conflicts.some((conflict) => conflict.field === 'category')).toBe(true)
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

  it('lets executable first-party connectors win while retaining lower-tier action coverage', () => {
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
    expect(gmail?.connector.actions.map((action) => action.id).sort()).toEqual(['messages.search', 'messages.send'])
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
