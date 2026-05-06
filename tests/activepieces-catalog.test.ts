import { describe, expect, it } from 'vitest'
import {
  buildActivepiecesConnectors,
  buildIntegrationToolCatalog,
  composeIntegrationRegistry,
  createActivepiecesExecutorProvider,
  InMemoryConnectionStore,
  IntegrationHub,
  listActivepiecesCatalogEntries,
  searchIntegrationTools,
} from '../src/index'

describe('Activepieces community catalog import', () => {
  it('vendors the MIT community connector catalog as normalized metadata', () => {
    const entries = listActivepiecesCatalogEntries()
    const ids = entries.map((entry) => entry.id)

    expect(entries.length).toBeGreaterThanOrEqual(650)
    expect(new Set(ids).size).toBe(ids.length)
    expect(entries.find((entry) => entry.id === 'slack')).toMatchObject({
      title: 'Slack',
      source: {
        repository: 'https://github.com/activepieces/activepieces',
        license: 'MIT',
      },
    })
  })

  it('converts imported pieces into our standard IntegrationConnector contract', () => {
    const connectors = buildActivepiecesConnectors()
    const slack = connectors.find((connector) => connector.id === 'slack')

    expect(connectors.length).toBeGreaterThanOrEqual(650)
    expect(slack?.providerId).toBe('activepieces')
    expect(slack?.metadata).toMatchObject({
      source: 'activepieces-community',
      executable: false,
      runtime: 'activepieces-piece',
      catalogOnly: true,
      license: 'MIT',
    })
    expect(slack?.actions).toEqual([])
    expect(slack?.triggers).toBeUndefined()
    expect(slack?.metadata?.catalogActionCount).toBeGreaterThan(0)
    expect(slack?.metadata?.catalogTriggerCount).toBeGreaterThan(0)
  })

  it('does not feed catalog-only entries into the normal agent tool search path by default', () => {
    const tools = buildIntegrationToolCatalog(buildActivepiecesConnectors())
    const results = searchIntegrationTools(tools, 'send a slack message', { maxRisk: 'write' })

    expect(results).toEqual([])
  })

  it('can expose raw catalog action names for inspection when explicitly requested', () => {
    const slack = buildActivepiecesConnectors({ includeCatalogActions: true })
      .find((connector) => connector.id === 'slack')

    expect(slack?.actions.some((action) => action.id.includes('send.message'))).toBe(true)
    expect(slack?.triggers?.length).toBeGreaterThan(0)
  })

  it('can promote the full catalog to gateway-executable when a runtime executor is supplied', async () => {
    const provider = createActivepiecesExecutorProvider({
      executeAction: (invocation) => ({
        ok: true,
        action: invocation.request.action,
        output: {
          piece: invocation.piece.id,
          package: invocation.piece.npmPackage,
          actionId: invocation.piece.actionId,
          input: invocation.request.input,
        },
      }),
    })
    const connectors = await provider.listConnectors()
    const slack = connectors.find((connector) => connector.id === 'slack')
    const send = slack?.actions.find((action) => action.risk !== 'read') ?? slack?.actions[0]

    expect(connectors.length).toBeGreaterThanOrEqual(650)
    expect(slack?.metadata).toMatchObject({
      source: 'activepieces-community',
      executable: true,
      catalogOnly: false,
      supportTier: 'gatewayExecutable',
    })
    expect(send).toBeDefined()

    const hub = new IntegrationHub({
      providers: [provider],
      store: new InMemoryConnectionStore(),
      capabilitySecret: 'secret',
    })
    await hub.upsertConnection({
      id: 'conn-slack',
      owner: { type: 'user', id: 'u1' },
      providerId: 'activepieces',
      connectorId: 'slack',
      status: 'active',
      grantedScopes: [...(slack?.scopes ?? [])],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    const capability = await hub.issueCapability({
      subject: { type: 'sandbox', id: 's1' },
      connectionId: 'conn-slack',
      scopes: send!.requiredScopes,
      allowedActions: [send!.id],
      ttlMs: 60_000,
    })
    const result = await hub.invokeWithCapability(capability.token, {
      action: send!.id,
      input: { text: 'hello' },
    })

    expect(result.ok).toBe(true)
    expect(result.output).toMatchObject({ piece: 'slack', actionId: send!.id, input: { text: 'hello' } })
  })

  it('feeds executable catalog entries into the deduped registry and tool search path', async () => {
    const provider = createActivepiecesExecutorProvider({
      executeAction: () => ({ ok: true, action: 'noop' }),
    })
    const registry = composeIntegrationRegistry([
      { id: 'activepieces', connectors: await provider.listConnectors() },
    ])
    const slack = registry.byId.get('slack')
    const tools = buildIntegrationToolCatalog(registry.connectors)
    const results = searchIntegrationTools(tools, 'send slack message', { maxRisk: 'write' })

    expect(slack?.supportTier).toBe('gatewayExecutable')
    expect(slack?.connector.metadata?.registry).toMatchObject({
      supportTier: 'gatewayExecutable',
      toolBindable: true,
    })
    expect(results.some((result) => result.tool.connectorId === 'slack')).toBe(true)
  })

  it('rejects unknown executable catalog actions before dispatching to the runtime', async () => {
    let called = false
    const provider = createActivepiecesExecutorProvider({
      executeAction: () => {
        called = true
        return { ok: true, action: 'should-not-run' }
      },
    })

    await expect(provider.invokeAction({
      id: 'conn-slack',
      owner: { type: 'user', id: 'u1' },
      providerId: 'activepieces',
      connectorId: 'slack',
      status: 'active',
      grantedScopes: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }, {
      connectionId: 'conn-slack',
      action: 'not-a-real-action',
    })).rejects.toMatchObject({ code: 'action_not_found' })
    expect(called).toBe(false)
  })

  it('applies curated overrides for top connectors', () => {
    const connectors = buildActivepiecesConnectors({ includeCatalogActions: true })
    const stripe = connectors.find((c) => c.id === 'stripe')

    expect(stripe?.metadata?.overridden).toBe(true)
    const cancelSub = stripe?.actions.find((a) => a.id === 'stripe.cancel.subscription')
    expect(cancelSub?.risk).toBe('destructive')
    const createRefund = stripe?.actions.find((a) => a.id === 'stripe.create.refund')
    expect(createRefund?.risk).toBe('destructive')

    const slack = connectors.find((c) => c.id === 'slack')
    expect(slack?.category).toBe('chat')
    expect(stripe?.category).toBe('crm')
  })
})
