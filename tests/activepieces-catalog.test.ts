import { describe, expect, it } from 'vitest'
import {
  buildActivepiecesConnectors,
  buildTangleIntegrationCatalogConnectors,
  buildIntegrationToolCatalog,
  composeIntegrationRegistry,
  createTangleCatalogHttpExecutor,
  createTangleCatalogExecutorProvider,
  createTangleCatalogCredentialAuthResolver,
  createTangleCatalogHttpAuthResolver,
  createTangleCatalogRuntimeHandler,
  createTangleCatalogInstalledPackageExecutor,
  startTangleCatalogRuntimeNodeServer,
  InMemoryIntegrationSecretStore,
  InMemoryConnectionStore,
  IntegrationHub,
  listActivepiecesCatalogEntries,
  listTangleIntegrationCatalogEntries,
  searchIntegrationTools,
  verifyTangleCatalogRuntimeSignature,
  TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER,
} from '../src/index'

describe('Activepieces community catalog import', () => {
  it('exposes Tangle-named catalog APIs for product-facing consumers', () => {
    const entries = listTangleIntegrationCatalogEntries()
    const connectors = buildTangleIntegrationCatalogConnectors()
    const slack = connectors.find((connector) => connector.id === 'slack')

    expect(entries.length).toBe(listActivepiecesCatalogEntries().length)
    expect(connectors.length).toBe(buildActivepiecesConnectors().length)
    expect(JSON.stringify(entries[0])).not.toContain('activepieces')
    expect(slack?.providerId).toBe('tangle-catalog')
    expect(slack?.metadata).toMatchObject({
      source: 'tangle-integrations-catalog',
      runtime: 'tangle-catalog-runtime',
      providerId: 'tangle-catalog',
    })
    expect(JSON.stringify(slack)).not.toContain('activepieces')
  })

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
    const slackEntry = listActivepiecesCatalogEntries()
      .find((entry) => entry.id === 'slack')
    const activeCampaign = listTangleIntegrationCatalogEntries()
      .find((entry) => entry.id === 'activecampaign')

    expect(slack?.actions.some((action) => action.id.includes('send.message'))).toBe(true)
    expect(slackEntry?.actions.every((action) => typeof action.upstreamName === 'string')).toBe(true)
    expect(slack?.triggers?.length).toBeGreaterThan(0)
    expect(activeCampaign?.authFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'apiUrl', secret: false }),
      expect.objectContaining({ key: 'apiKey', secret: true }),
    ]))
    expect(activeCampaign?.triggers.every((trigger) => typeof trigger.upstreamName === 'string')).toBe(true)
  })

  it('can promote the full catalog to gateway-executable when a runtime executor is supplied', async () => {
    const provider = createTangleCatalogExecutorProvider({
      executeAction: (invocation) => ({
        ok: true,
        action: invocation.request.action,
        output: {
          piece: invocation.piece.id,
          package: invocation.piece.packageName,
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
      source: 'tangle-integrations-catalog',
      executable: true,
      catalogOnly: false,
      supportTier: 'gatewayExecutable',
      runtime: 'tangle-catalog-runtime',
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
      providerId: 'tangle-catalog',
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
    const provider = createTangleCatalogExecutorProvider({
      executeAction: () => ({ ok: true, action: 'noop' }),
    })
    const registry = composeIntegrationRegistry([
      { id: 'tangle-catalog', connectors: await provider.listConnectors() },
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

  it('routes catalog trigger subscriptions through the same Tangle provider boundary', async () => {
    const provider = createTangleCatalogExecutorProvider({
      executeAction: () => ({ ok: true, action: 'noop' }),
      subscribeTrigger: ({ connection, trigger, piece, targetUrl }) => ({
        id: 'sub-1',
        connectionId: connection.id,
        trigger: trigger.id,
        targetUrl,
        status: 'active',
        createdAt: new Date(0).toISOString(),
        metadata: {
          pieceId: piece.id,
          upstreamTriggerName: piece.upstreamTriggerName,
        },
      }),
    })
    const slack = (await provider.listConnectors()).find((connector) => connector.id === 'slack')!
    const trigger = slack.triggers?.find((candidate) => candidate.id === 'new.message') ?? slack.triggers![0]!
    const subscription = await provider.subscribeTrigger!({
      id: 'conn-slack',
      owner: { type: 'user', id: 'u1' },
      providerId: 'tangle-catalog',
      connectorId: 'slack',
      status: 'active',
      grantedScopes: slack.scopes,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }, trigger.id, 'https://app.example/hook')

    expect(subscription).toMatchObject({
      connectionId: 'conn-slack',
      trigger: trigger.id,
      targetUrl: 'https://app.example/hook',
      metadata: {
        pieceId: 'slack',
        upstreamTriggerName: expect.any(String),
      },
    })
  })

  it('rejects unknown executable catalog actions before dispatching to the runtime', async () => {
    let called = false
    const provider = createTangleCatalogExecutorProvider({
      executeAction: () => {
        called = true
        return { ok: true, action: 'should-not-run' }
      },
    })

    await expect(provider.invokeAction({
      id: 'conn-slack',
      owner: { type: 'user', id: 'u1' },
      providerId: 'tangle-catalog',
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

  it('ships a signed HTTP runtime executor protocol for hardened workers', async () => {
    let received: unknown
    let signature: string | null = null
    let url = ''
    const executeAction = createTangleCatalogHttpExecutor({
      endpoint: 'https://runtime.example',
      secret: 'runtime-secret',
      requestId: () => 'req-1',
      fetchImpl: async (requestUrl, init) => {
        url = String(requestUrl)
        signature = new Headers(init?.headers).get(TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER)
        received = JSON.parse(String(init?.body))
        return Response.json({ ok: true, action: 'slack.send.message', output: { sent: true } })
      },
    })
    const provider = createTangleCatalogExecutorProvider({ executeAction })
    const slack = (await provider.listConnectors()).find((connector) => connector.id === 'slack')!
    const action = slack.actions.find((candidate) => candidate.risk !== 'read')!
    const result = await provider.invokeAction({
      id: 'conn-slack',
      owner: { type: 'user', id: 'u1' },
      providerId: 'tangle-catalog',
      connectorId: 'slack',
      status: 'active',
      grantedScopes: slack.scopes,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }, {
      connectionId: 'conn-slack',
      action: action.id,
      input: { text: 'hello' },
      idempotencyKey: 'idem-1',
    })

    const serialized = JSON.stringify(received)
    expect(url).toBe('https://runtime.example/v1/integration-catalog/actions/invoke')
    expect(signature).toMatch(/^sha256=/)
    expect(verifyTangleCatalogRuntimeSignature(serialized, signature, 'runtime-secret')).toBe(true)
    expect(received).toMatchObject({
      version: 1,
      requestId: 'req-1',
      providerId: 'tangle-catalog',
      piece: { id: 'slack', actionId: action.id },
      action: { id: action.id, input: { text: 'hello' }, idempotencyKey: 'idem-1' },
    })
    expect(serialized).not.toContain('activepieces')
    expect(result).toEqual({ ok: true, action: 'slack.send.message', output: { sent: true } })
  })

  it('hosts the signed Tangle catalog runtime endpoint with catalog/action validation', async () => {
    const runtime = createTangleCatalogRuntimeHandler({
      secret: 'runtime-secret',
      executeAction: ({ request, connector, action }) => ({
        ok: true,
        action: action.id,
        output: {
          connectorId: connector.id,
          input: request.action.input,
        },
      }),
    })
    const executeAction = createTangleCatalogHttpExecutor({
      endpoint: 'https://runtime.example',
      secret: 'runtime-secret',
      requestId: () => 'req-runtime',
      fetchImpl: async (_requestUrl, init) => {
        const response = await runtime({
          body: String(init?.body),
          headers: new Headers(init?.headers),
        })
        return Response.json(response.body, { status: response.status, headers: response.headers })
      },
    })
    const provider = createTangleCatalogExecutorProvider({ executeAction })
    const slack = (await provider.listConnectors()).find((connector) => connector.id === 'slack')!
    const action = slack.actions.find((candidate) => candidate.risk !== 'read')!
    const result = await provider.invokeAction({
      id: 'conn-slack',
      owner: { type: 'user', id: 'u1' },
      providerId: 'tangle-catalog',
      connectorId: 'slack',
      status: 'active',
      grantedScopes: slack.scopes,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }, {
      connectionId: 'conn-slack',
      action: action.id,
      input: { text: 'hello' },
    })

    expect(result).toEqual({
      ok: true,
      action: action.id,
      output: { connectorId: 'slack', input: { text: 'hello' } },
    })
  })

  it('rejects unsigned or unknown Tangle catalog runtime requests before dispatch', async () => {
    let called = false
    const runtime = createTangleCatalogRuntimeHandler({
      secret: 'runtime-secret',
      executeAction: () => {
        called = true
        return { ok: true, action: 'should-not-run' }
      },
    })
    const provider = createTangleCatalogExecutorProvider({
      executeAction: () => ({ ok: true, action: 'noop' }),
    })
    const slack = (await provider.listConnectors()).find((connector) => connector.id === 'slack')!
    const response = await runtime({
      headers: {},
      body: {
        version: 1,
        requestId: 'req-unsigned',
        providerId: 'tangle-catalog',
        connection: {
          id: 'conn-slack',
          owner: { type: 'user', id: 'u1' },
          providerId: 'tangle-catalog',
          connectorId: 'slack',
          status: 'active',
          grantedScopes: slack.scopes,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        connector: {
          id: 'slack',
          title: 'Slack',
          auth: 'oauth2',
          scopes: slack.scopes,
          metadata: slack.metadata,
        },
        piece: { id: 'slack', actionId: 'not-real' },
        action: { id: 'not-real', input: {} },
      },
    })

    expect(response.status).toBe(401)
    expect(response.body.output).toMatchObject({ code: 'signature_invalid' })
    expect(called).toBe(false)
  })

  it('can execute installed catalog runtime packages with explicit action aliases', async () => {
    const runtime = createTangleCatalogRuntimeHandler({
      secret: 'runtime-secret',
      executeAction: createTangleCatalogInstalledPackageExecutor({
        moduleLoader: async (packageName) => {
          expect(packageName).toBe('@activepieces/piece-slack')
          return {
            slack: {
              actions: [
                {
                  name: 'send_channel_message',
                  displayName: 'Send Message To A Channel',
                  run: async ({ propsValue, auth }: { propsValue: unknown; auth: unknown }) => ({ propsValue, auth }),
                },
              ],
            },
          }
        },
        actionAliases: {
          slack: {
            'slack.send.message': 'send_channel_message',
          },
        },
        resolveAuth: (connection) => ({ secretRef: connection.secretRef?.id }),
      }),
    })
    const executeAction = createTangleCatalogHttpExecutor({
      endpoint: 'https://runtime.example',
      secret: 'runtime-secret',
      requestId: () => 'req-installed',
      fetchImpl: async (_requestUrl, init) => {
        const response = await runtime({
          body: String(init?.body),
          headers: new Headers(init?.headers),
        })
        return Response.json(response.body, { status: response.status, headers: response.headers })
      },
    })
    const provider = createTangleCatalogExecutorProvider({ executeAction })
    const slack = (await provider.listConnectors()).find((connector) => connector.id === 'slack')!
    const action = slack.actions.find((candidate) => candidate.id === 'slack.send.message')!
    const result = await provider.invokeAction({
      id: 'conn-slack',
      owner: { type: 'user', id: 'u1' },
      providerId: 'tangle-catalog',
      connectorId: 'slack',
      status: 'active',
      grantedScopes: slack.scopes,
      secretRef: { provider: 'vault', id: 'secret-slack' },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }, {
      connectionId: 'conn-slack',
      action: action.id,
      input: { channel: 'C1', text: 'hello' },
    })

    expect(result).toEqual({
      ok: true,
      action: 'slack.send.message',
      output: {
        propsValue: { channel: 'C1', text: 'hello' },
        auth: { secretRef: 'secret-slack' },
      },
    })
  })

  it('can execute installed catalog runtime packages through checked-in upstream action names', async () => {
    const secrets = new InMemoryIntegrationSecretStore()
    await secrets.put({ provider: 'vault', id: 'secret-slack' }, {
      kind: 'oauth2',
      accessToken: 'xoxb-token',
      refreshToken: 'refresh-token',
      expiresAt: 123,
    })
    const runtime = createTangleCatalogRuntimeHandler({
      secret: 'runtime-secret',
      executeAction: createTangleCatalogInstalledPackageExecutor({
        moduleLoader: async (packageName) => {
          expect(packageName).toBe('@activepieces/piece-slack')
          return {
            slack: {
              actions: [
                {
                  name: 'slackSendMessageAction',
                  displayName: 'Send Message To A Channel',
                  run: async ({ propsValue, auth }: { propsValue: unknown; auth: unknown }) => ({ propsValue, auth }),
                },
              ],
            },
          }
        },
        resolveAuth: createTangleCatalogCredentialAuthResolver({ secrets }),
      }),
    })
    const executeAction = createTangleCatalogHttpExecutor({
      endpoint: 'https://runtime.example',
      secret: 'runtime-secret',
      requestId: () => 'req-upstream-name',
      fetchImpl: async (_requestUrl, init) => {
        const response = await runtime({
          body: String(init?.body),
          headers: new Headers(init?.headers),
        })
        return Response.json(response.body, { status: response.status, headers: response.headers })
      },
    })
    const provider = createTangleCatalogExecutorProvider({ executeAction })
    const slack = (await provider.listConnectors()).find((connector) => connector.id === 'slack')!
    const action = slack.actions.find((candidate) => candidate.id === 'slack.send.message')!
    const result = await provider.invokeAction({
      id: 'conn-slack',
      owner: { type: 'user', id: 'u1' },
      providerId: 'tangle-catalog',
      connectorId: 'slack',
      status: 'active',
      grantedScopes: slack.scopes,
      secretRef: { provider: 'vault', id: 'secret-slack' },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }, {
      connectionId: 'conn-slack',
      action: action.id,
      input: { channel: 'C1', text: 'hello' },
    })

    expect(result).toEqual({
      ok: true,
      action: 'slack.send.message',
      output: {
        propsValue: { channel: 'C1', text: 'hello' },
        auth: {
          access_token: 'xoxb-token',
          refresh_token: 'refresh-token',
          expires_at: 123,
        },
      },
    })
  })

  it('resolves runtime credentials through a signed platform HTTP resolver', async () => {
    let signature: string | null = null
    let received: unknown
    const resolveAuth = createTangleCatalogHttpAuthResolver({
      endpoint: 'https://platform.example',
      secret: 'credential-secret',
      requestId: () => 'auth-req-1',
      fetchImpl: async (_requestUrl, init) => {
        signature = new Headers(init?.headers).get(TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER)
        received = JSON.parse(String(init?.body))
        return Response.json({
          credentials: {
            kind: 'oauth2',
            accessToken: 'runtime-access-token',
            refreshToken: 'runtime-refresh-token',
            expiresAt: 123,
          },
        })
      },
    })

    const auth = await resolveAuth({
      id: 'conn-slack',
      owner: { type: 'user', id: 'u1' },
      providerId: 'tangle-catalog',
      connectorId: 'slack',
      status: 'active',
      grantedScopes: [],
      secretRef: { provider: 'vault', id: 'secret-slack' },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    const serialized = JSON.stringify(received)

    expect(verifyTangleCatalogRuntimeSignature(serialized, signature, 'credential-secret')).toBe(true)
    expect(received).toMatchObject({
      version: 1,
      requestId: 'auth-req-1',
      providerId: 'tangle-catalog',
      connectorId: 'slack',
      connectionId: 'conn-slack',
      secretRef: { provider: 'vault', id: 'secret-slack' },
    })
    expect(auth).toEqual({
      access_token: 'runtime-access-token',
      refresh_token: 'runtime-refresh-token',
      expires_at: 123,
    })
  })

  it('ships a Node runtime server for installed catalog package execution', async () => {
    const runtime = await startTangleCatalogRuntimeNodeServer({
      secret: 'runtime-secret',
      port: 0,
      executor: {
        moduleLoader: async (packageName) => {
          expect(packageName).toBe('@activepieces/piece-slack')
          return {
            slack: {
              actions: [
                {
                  name: 'slackSendMessageAction',
                  run: async ({ propsValue, auth }: { propsValue: unknown; auth: unknown }) => ({ propsValue, auth }),
                },
              ],
            },
          }
        },
        resolveAuth: () => ({ access_token: 'runtime-token' }),
      },
    })
    try {
      const executeAction = createTangleCatalogHttpExecutor({
        endpoint: runtime.url,
        secret: 'runtime-secret',
        requestId: () => 'node-runtime-req-1',
      })
      const provider = createTangleCatalogExecutorProvider({ executeAction })
      const slack = (await provider.listConnectors()).find((connector) => connector.id === 'slack')!
      const action = slack.actions.find((candidate) => candidate.id === 'slack.send.message')!
      const result = await provider.invokeAction({
        id: 'conn-slack',
        owner: { type: 'user', id: 'u1' },
        providerId: 'tangle-catalog',
        connectorId: 'slack',
        status: 'active',
        grantedScopes: slack.scopes,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }, {
        connectionId: 'conn-slack',
        action: action.id,
        input: { channel: 'C1', text: 'hello' },
      })

      expect(result).toEqual({
        ok: true,
        action: 'slack.send.message',
        output: {
          propsValue: { channel: 'C1', text: 'hello' },
          auth: { access_token: 'runtime-token' },
        },
      })
      const health = await fetch(`${runtime.url}/health`)
      expect(health.status).toBe(200)
    } finally {
      await runtime.close()
    }
  })

  it('returns explicit runtime errors when installed catalog packages are missing', async () => {
    const runtime = createTangleCatalogRuntimeHandler({
      secret: 'runtime-secret',
      executeAction: createTangleCatalogInstalledPackageExecutor({
        moduleLoader: async () => {
          throw new Error('Cannot find package')
        },
      }),
    })
    const executeAction = createTangleCatalogHttpExecutor({
      endpoint: 'https://runtime.example',
      secret: 'runtime-secret',
      requestId: () => 'req-missing-runtime',
      fetchImpl: async (_requestUrl, init) => {
        const response = await runtime({
          body: String(init?.body),
          headers: new Headers(init?.headers),
        })
        return Response.json(response.body, { status: response.status, headers: response.headers })
      },
    })
    const provider = createTangleCatalogExecutorProvider({ executeAction })
    const slack = (await provider.listConnectors()).find((connector) => connector.id === 'slack')!
    const action = slack.actions.find((candidate) => candidate.id === 'slack.send.message')!
    const result = await provider.invokeAction({
      id: 'conn-slack',
      owner: { type: 'user', id: 'u1' },
      providerId: 'tangle-catalog',
      connectorId: 'slack',
      status: 'active',
      grantedScopes: slack.scopes,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }, {
      connectionId: 'conn-slack',
      action: action.id,
      input: { channel: 'C1', text: 'hello' },
    })

    expect(result.ok).toBe(false)
    expect(result.output).toMatchObject({ code: 'runtime_not_installed' })
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
