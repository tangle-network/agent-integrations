import { describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider } from '../src/adapter-provider'
import * as bundledAdapters from '../src/connectors/adapters/index'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/index'
import {
  getBundledAdapterManifest,
  listBundledAdapterKinds,
  listBundledConnectorAdapters,
} from '../src/connectors/bundled-manifests'
import { listTangleNativeAdapterIds } from '../src/tangle-catalog'

describe('connector adapter factory registry', () => {
  it('constructs every factory from its declared environment mapping', () => {
    const kinds = CONNECTOR_ADAPTER_FACTORIES.map(
      (definition) => definition.kind,
    )
    expect(new Set(kinds).size).toBe(kinds.length)

    for (const definition of CONNECTOR_ADAPTER_FACTORIES) {
      const env: Record<string, string> = {}
      for (const envNames of Object.values(definition.envMap)) {
        const name = Array.isArray(envNames) ? envNames[0] : envNames
        if (name) env[name] = `test-${name.toLowerCase()}`
      }
      const options = resolveConnectorAdapterFactoryOptions(definition, env)
      expect(options, definition.kind).not.toBeNull()
      expect(
        definition.factory(options ?? {}).manifest.kind,
        definition.kind,
      ).toBe(definition.kind)
    }
  })

  it('fails closed when required factory configuration is absent', () => {
    const slack = CONNECTOR_ADAPTER_FACTORIES.find(
      (definition) => definition.kind === 'slack',
    )
    expect(slack).toBeDefined()
    expect(
      resolveConnectorAdapterFactoryOptions(slack!, {
        SLACK_OAUTH_CLIENT_ID: 'client-id',
      }),
    ).toBeNull()
  })

  it('includes factory adapters in the native adapter inventory', () => {
    const nativeIds = new Set(listTangleNativeAdapterIds())
    for (const definition of CONNECTOR_ADAPTER_FACTORIES) {
      expect(nativeIds.has(definition.kind), definition.kind).toBe(true)
    }
  })

  it('keeps Bigin OAuth credentials separate from the Zoho CRM aliases', () => {
    const definition = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'bigin-by-zoho',
    )
    expect(definition).toBeDefined()
    expect(definition!.envMap).toEqual({
      clientId: 'BIGIN_BY_ZOHO_OAUTH_CLIENT_ID',
      clientSecret: 'BIGIN_BY_ZOHO_OAUTH_CLIENT_SECRET',
    })

    const options = resolveConnectorAdapterFactoryOptions(definition!, {
      ZOHO_CRM_OAUTH_CLIENT_ID: 'crm-client',
      ZOHO_CRM_OAUTH_CLIENT_SECRET: 'crm-secret',
      BIGIN_BY_ZOHO_OAUTH_CLIENT_ID: 'bigin-client',
      BIGIN_BY_ZOHO_OAUTH_CLIENT_SECRET: 'bigin-secret',
    })
    expect(options).toEqual({
      clientId: 'bigin-client',
      clientSecret: 'bigin-secret',
    })
    expect(definition!.factory(options!).manifest.auth).toMatchObject({
      kind: 'oauth2',
      clientIdEnv: 'BIGIN_BY_ZOHO_OAUTH_CLIENT_ID',
      clientSecretEnv: 'BIGIN_BY_ZOHO_OAUTH_CLIENT_SECRET',
    })
  })

  it('keeps inbound receivers out of public discovery while retaining their stable ids', () => {
    const publicAdapters = listBundledConnectorAdapters()
    const kinds = publicAdapters.map((adapter) => adapter.manifest.kind)
    expect(new Set(kinds).size).toBe(kinds.length)

    const publicStripe = publicAdapters.find((adapter) => adapter.manifest.kind === 'stripe')
    expect(publicStripe).toBe(bundledAdapters.stripeConnector)
    expect(publicStripe?.manifest.auth.kind).toBe('api-key')
    expect(publicStripe?.manifest.capabilities.map((capability) => capability.name)).toEqual(
      expect.arrayContaining(['customers.create', 'payment-intents.create']),
    )

    expect(bundledAdapters.stripeWebhookReceiverConnector.manifest.kind).toBe('stripe')
    expect(bundledAdapters.stripeWebhookReceiverConnector.inboundOnly).toBe(true)
    expect(publicAdapters).not.toContain(bundledAdapters.stripeWebhookReceiverConnector)

    expect(bundledAdapters.slackEventsConnector.inboundOnly).toBe(true)
    expect(publicAdapters).not.toContain(bundledAdapters.slackEventsConnector)

    expect(listBundledAdapterKinds()).toContain('stripe')
    expect(getBundledAdapterManifest('stripe')?.auth.kind).toBe('api-key')
    expect(listTangleNativeAdapterIds()).toContain('stripe')

    expect(listBundledAdapterKinds()).toContain('slack')
    expect(listBundledAdapterKinds()).not.toContain('slack-inbound')
    expect(getBundledAdapterManifest('slack')?.auth.kind).toBe('oauth2')
    expect(getBundledAdapterManifest('slack-inbound')).toBeUndefined()

    const slackOAuthFactory = CONNECTOR_ADAPTER_FACTORIES.find(
      (definition) => definition.kind === 'slack',
    )
    expect(slackOAuthFactory).toBeDefined()
    expect(slackOAuthFactory!.factory({
      clientId: 'slack-client-id',
      clientSecret: 'slack-client-secret',
    }).manifest.auth.kind).toBe('oauth2')
  })

  it('registers user-supplied Trello credentials without an app secret', () => {
    const definition = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'trello',
    )
    expect(definition).toBeDefined()
    expect(definition!.envMap).toEqual({})
    expect(resolveConnectorAdapterFactoryOptions(definition!, {})).toEqual({})
  })

  it('surfaces ClickUp as OAuth while retaining personal tokens as a secondary option', async () => {
    const definition = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'clickup',
    )
    const options = resolveConnectorAdapterFactoryOptions(definition!, {
      CLICKUP_OAUTH_CLIENT_ID: 'client-id',
      CLICKUP_OAUTH_CLIENT_SECRET: 'client-secret',
    })
    const provider = createConnectorAdapterProvider({
      adapters: [definition!.factory(options!)],
      resolveDataSource: () => ({ kind: 'clickup', id: 'clickup-source' }) as never,
    })

    expect(await provider.listConnectors()).toEqual([
      expect.objectContaining({
        id: 'clickup',
        auth: 'oauth2',
        metadata: expect.objectContaining({
          authOptions: ['api-key', 'oauth2'],
          preferredAuth: 'oauth2',
        }),
      }),
    ])
  })

  it('runs the complete Microsoft 365 pack through the shared OAuth application', () => {
    const kinds = [
      'microsoft-excel-365',
      'microsoft-365-people',
      'microsoft-365-planner',
      'microsoft-todo',
      'microsoft-onenote',
      'microsoft-power-bi',
      'microsoft-dynamics-365-business-central',
    ]
    const envMap = {
      clientId: ['MICROSOFT_OAUTH_CLIENT_ID', 'MS_OAUTH_CLIENT_ID'],
      clientSecret: ['MICROSOFT_OAUTH_CLIENT_SECRET', 'MS_OAUTH_CLIENT_SECRET'],
    }

    for (const kind of kinds) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition!.envMap, kind).toEqual(envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        MICROSOFT_OAUTH_CLIENT_ID: 'client-id',
        MICROSOFT_OAUTH_CLIENT_SECRET: 'client-secret',
      }), kind).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' })
    }
  })

  it('registers OAuth providers behind their application settings', () => {
    const expected = {
      salesforce: ['SALESFORCE_OAUTH_CLIENT_ID', 'SALESFORCE_OAUTH_CLIENT_SECRET'],
      dropbox: ['DROPBOX_OAUTH_CLIENT_ID', 'DROPBOX_OAUTH_CLIENT_SECRET'],
      box: ['BOX_OAUTH_CLIENT_ID', 'BOX_OAUTH_CLIENT_SECRET'],
      zoom: ['ZOOM_OAUTH_CLIENT_ID', 'ZOOM_OAUTH_CLIENT_SECRET'],
      calendly: ['CALENDLY_OAUTH_CLIENT_ID', 'CALENDLY_OAUTH_CLIENT_SECRET'],
      asana: ['ASANA_OAUTH_CLIENT_ID', 'ASANA_OAUTH_CLIENT_SECRET'],
      'google-contacts': ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
      'google-slides': ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
      googlechat: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
      'google-tasks': ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
      'google-analytics': ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
      'google-meet': ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
      'google-search-console': ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
      linear: ['LINEAR_OAUTH_CLIENT_ID', 'LINEAR_OAUTH_CLIENT_SECRET'],
      miro: ['MIRO_OAUTH_CLIENT_ID', 'MIRO_OAUTH_CLIENT_SECRET'],
      monday: ['MONDAY_OAUTH_CLIENT_ID', 'MONDAY_OAUTH_CLIENT_SECRET'],
      clickup: ['CLICKUP_OAUTH_CLIENT_ID', 'CLICKUP_OAUTH_CLIENT_SECRET'],
      basecamp: ['BASECAMP_OAUTH_CLIENT_ID', 'BASECAMP_OAUTH_CLIENT_SECRET'],
      todoist: ['TODOIST_OAUTH_CLIENT_ID', 'TODOIST_OAUTH_CLIENT_SECRET'],
      'jira-cloud': ['ATLASSIAN_OAUTH_CLIENT_ID', 'ATLASSIAN_OAUTH_CLIENT_SECRET'],
    } as const

    for (const [kind, envNames] of Object.entries(expected)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(Object.values(definition!.envMap)).toEqual(envNames)
      expect(resolveConnectorAdapterFactoryOptions(definition!, {}), kind).toBeNull()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envNames[0]]: 'client-id',
      }), kind).toBeNull()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envNames[1]]: 'client-secret',
      }), kind).toBeNull()
    }
  })

  it('wires every direct OAuth2 blocker to its manifest credential pair', () => {
    const expected = {
      'adobe-creative-cloud': {
        clientId: 'ADOBE_CREATIVE_CLOUD_OAUTH_CLIENT_ID',
        clientSecret: 'ADOBE_CREATIVE_CLOUD_OAUTH_CLIENT_SECRET',
      },
      adp: {
        clientId: 'ADP_OAUTH_CLIENT_ID',
        clientSecret: 'ADP_OAUTH_CLIENT_SECRET',
      },
      bexio: {
        clientId: 'BEXIO_OAUTH_CLIENT_ID',
        clientSecret: 'BEXIO_OAUTH_CLIENT_SECRET',
      },
      bigcommerce: {
        clientId: 'BIGCOMMERCE_OAUTH_CLIENT_ID',
        clientSecret: 'BIGCOMMERCE_OAUTH_CLIENT_SECRET',
      },
      canva: {
        clientId: 'CANVA_OAUTH_CLIENT_ID',
        clientSecret: 'CANVA_OAUTH_CLIENT_SECRET',
      },
      clicdata: {
        clientId: 'CLICDATA_OAUTH_CLIENT_ID',
        clientSecret: 'CLICDATA_OAUTH_CLIENT_SECRET',
      },
      clio: {
        clientId: 'CLIO_OAUTH_CLIENT_ID',
        clientSecret: 'CLIO_OAUTH_CLIENT_SECRET',
      },
      cloudconvert: {
        clientId: 'CLOUDCONVERT_OAUTH_CLIENT_ID',
        clientSecret: 'CLOUDCONVERT_OAUTH_CLIENT_SECRET',
      },
      'constant-contact': {
        clientId: 'CONSTANT_CONTACT_OAUTH_CLIENT_ID',
        clientSecret: 'CONSTANT_CONTACT_OAUTH_CLIENT_SECRET',
      },
      demandbase: {
        clientId: 'DEMANDBASE_OAUTH_CLIENT_ID',
        clientSecret: 'DEMANDBASE_OAUTH_CLIENT_SECRET',
      },
      discord: {
        clientId: 'DISCORD_OAUTH_CLIENT_ID',
        clientSecret: 'DISCORD_OAUTH_CLIENT_SECRET',
      },
      formstack: {
        clientId: 'FORMSTACK_OAUTH_CLIENT_ID',
        clientSecret: 'FORMSTACK_OAUTH_CLIENT_SECRET',
      },
      'free-agent': {
        clientId: 'FREE_AGENT_OAUTH_CLIENT_ID',
        clientSecret: 'FREE_AGENT_OAUTH_CLIENT_SECRET',
      },
      gitea: {
        clientId: 'GITEA_OAUTH_CLIENT_ID',
        clientSecret: 'GITEA_OAUTH_CLIENT_SECRET',
      },
      gusto: {
        clientId: 'GUSTO_OAUTH_CLIENT_ID',
        clientSecret: 'GUSTO_OAUTH_CLIENT_SECRET',
      },
      'insta-charts': {
        clientId: 'INSTACHARTS_OAUTH_CLIENT_ID',
        clientSecret: 'INSTACHARTS_OAUTH_CLIENT_SECRET',
      },
      lever: {
        clientId: 'LEVER_OAUTH_CLIENT_ID',
        clientSecret: 'LEVER_OAUTH_CLIENT_SECRET',
      },
      lightfunnels: {
        clientId: 'LIGHTFUNNELS_OAUTH_CLIENT_ID',
        clientSecret: 'LIGHTFUNNELS_OAUTH_CLIENT_SECRET',
      },
      netlify: {
        clientId: 'NETLIFY_OAUTH_CLIENT_ID',
        clientSecret: 'NETLIFY_OAUTH_CLIENT_SECRET',
      },
      nifty: {
        clientId: 'NIFTY_OAUTH_CLIENT_ID',
        clientSecret: 'NIFTY_OAUTH_CLIENT_SECRET',
      },
      opsgenie: {
        clientId: 'OPSGENIE_OAUTH_CLIENT_ID',
        clientSecret: 'OPSGENIE_OAUTH_CLIENT_SECRET',
      },
      pagerduty: {
        clientId: 'PAGERDUTY_OAUTH_CLIENT_ID',
        clientSecret: 'PAGERDUTY_OAUTH_CLIENT_SECRET',
      },
      paychex: {
        clientId: 'PAYCHEX_OAUTH_CLIENT_ID',
        clientSecret: 'PAYCHEX_OAUTH_CLIENT_SECRET',
      },
      pushbullet: {
        clientId: 'PUSHBULLET_OAUTH_CLIENT_ID',
        clientSecret: 'PUSHBULLET_OAUTH_CLIENT_SECRET',
      },
      reddit: {
        clientId: 'REDDIT_OAUTH_CLIENT_ID',
        clientSecret: 'REDDIT_OAUTH_CLIENT_SECRET',
      },
      rippling: {
        clientId: 'RIPPLING_OAUTH_CLIENT_ID',
        clientSecret: 'RIPPLING_OAUTH_CLIENT_SECRET',
      },
      sanity: {
        clientId: 'SANITY_OAUTH_CLIENT_ID',
        clientSecret: 'SANITY_OAUTH_CLIENT_SECRET',
      },
      sendpulse: {
        clientId: 'SENDPULSE_CLIENT_ID',
        clientSecret: 'SENDPULSE_CLIENT_SECRET',
      },
      snowflake: {
        clientId: 'SNOWFLAKE_OAUTH_CLIENT_ID',
        clientSecret: 'SNOWFLAKE_OAUTH_CLIENT_SECRET',
      },
      teable: {
        clientId: 'TEABLE_OAUTH_CLIENT_ID',
        clientSecret: 'TEABLE_OAUTH_CLIENT_SECRET',
      },
      tenzo: {
        clientId: 'TENZO_OAUTH_CLIENT_ID',
        clientSecret: 'TENZO_OAUTH_CLIENT_SECRET',
      },
      vercel: {
        clientId: 'VERCEL_OAUTH_CLIENT_ID',
        clientSecret: 'VERCEL_OAUTH_CLIENT_SECRET',
      },
      videoask: {
        clientId: 'VIDEOASK_OAUTH_CLIENT_ID',
        clientSecret: 'VIDEOASK_OAUTH_CLIENT_SECRET',
      },
      wootric: {
        clientId: 'WOOTRIC_OAUTH_CLIENT_ID',
        clientSecret: 'WOOTRIC_OAUTH_CLIENT_SECRET',
      },
      workday: {
        clientId: 'WORKDAY_OAUTH_CLIENT_ID',
        clientSecret: 'WORKDAY_OAUTH_CLIENT_SECRET',
      },
      zoominfo: {
        clientId: 'ZOOMINFO_OAUTH_CLIENT_ID',
        clientSecret: 'ZOOMINFO_OAUTH_CLIENT_SECRET',
      },
      zuora: {
        clientId: 'ZUORA_OAUTH_CLIENT_ID',
        clientSecret: 'ZUORA_OAUTH_CLIENT_SECRET',
      },
    } as const

    for (const [kind, envMap] of Object.entries(expected)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition!.envMap, kind).toEqual(envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientId]: 'client-id',
      }), kind).toBeNull()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientSecret]: 'client-secret',
      }), kind).toBeNull()
      const options = resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientId]: 'client-id',
        [envMap.clientSecret]: 'client-secret',
      })
      expect(options, kind).toEqual({
        clientId: 'client-id',
        clientSecret: 'client-secret',
      })
      const adapter = definition!.factory(options ?? {})
      expect(adapter.manifest.kind, kind).toBe(kind)
      expect(adapter.manifest.auth.kind, kind).toBe('oauth2')
    }
  })

  it('fails closed until the shared Figma and Wrike OAuth apps are fully configured', () => {
    const expected = {
      figma: {
        clientId: 'FIGMA_OAUTH_CLIENT_ID',
        clientSecret: 'FIGMA_OAUTH_CLIENT_SECRET',
      },
      figjam: {
        clientId: 'FIGMA_OAUTH_CLIENT_ID',
        clientSecret: 'FIGMA_OAUTH_CLIENT_SECRET',
      },
      wrike: {
        clientId: 'WRIKE_OAUTH_CLIENT_ID',
        clientSecret: 'WRIKE_OAUTH_CLIENT_SECRET',
      },
    } as const

    for (const [kind, envMap] of Object.entries(expected)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition!.envMap, kind).toEqual(envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientId]: 'client-id',
      }), kind).toBeNull()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientSecret]: 'client-secret',
      }), kind).toBeNull()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientId]: 'client-id',
        [envMap.clientSecret]: 'client-secret',
      }), kind).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' })
    }
  })

  it('registers self-serve business operations OAuth providers with complete credentials only', () => {
    const expected = {
      harvest: {
        clientId: 'HARVEST_OAUTH_CLIENT_ID',
        clientSecret: 'HARVEST_OAUTH_CLIENT_SECRET',
      },
      'google-my-business': {
        clientId: 'GOOGLE_OAUTH_CLIENT_ID',
        clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET',
      },
    } as const

    for (const [kind, envMap] of Object.entries(expected)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition!.envMap, kind).toEqual(envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientId]: 'client-id',
      }), kind).toBeNull()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientSecret]: 'client-secret',
      }), kind).toBeNull()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientId]: 'client-id',
        [envMap.clientSecret]: 'client-secret',
      }), kind).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' })
    }
  })

  it('registers eBay and TickTick only after their Basic-auth OAuth apps are fully configured', () => {
    const expected = {
      ebay: {
        clientId: 'EBAY_OAUTH_CLIENT_ID',
        clientSecret: 'EBAY_OAUTH_CLIENT_SECRET',
      },
      ticktick: {
        clientId: 'TICKTICK_OAUTH_CLIENT_ID',
        clientSecret: 'TICKTICK_OAUTH_CLIENT_SECRET',
      },
    } as const

    for (const [kind, envMap] of Object.entries(expected)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition!.envMap, kind).toEqual(envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientId]: 'client-id',
      }), kind).toBeNull()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientSecret]: 'client-secret',
      }), kind).toBeNull()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envMap.clientId]: 'client-id',
        [envMap.clientSecret]: 'client-secret',
      }), kind).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' })
    }
  })

  it('uses Harvest through the generic form-body authorization-code exchange', async () => {
    const definition = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'harvest',
    )
    expect(definition).toBeDefined()
    const options = resolveConnectorAdapterFactoryOptions(definition!, {
      HARVEST_OAUTH_CLIENT_ID: 'harvest-client-id',
      HARVEST_OAUTH_CLIENT_SECRET: 'harvest-client-secret',
    })
    expect(options).toEqual({
      clientId: 'harvest-client-id',
      clientSecret: 'harvest-client-secret',
    })

    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe('https://id.getharvest.com/api/v2/oauth2/token')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      })
      const body = init?.body as URLSearchParams
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('harvest-code')
      expect(body.get('client_id')).toBe('harvest-client-id')
      expect(body.get('client_secret')).toBe('harvest-client-secret')
      expect(body.get('redirect_uri')).toBe('https://id.tangle.tools/v1/hub/connections/oauth/callback')
      return new Response(JSON.stringify({
        access_token: 'harvest-access-token',
        refresh_token: 'harvest-refresh-token',
        expires_in: 3600,
        scope: 'harvest:all',
      }), {
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const provider = createConnectorAdapterProvider({
      adapters: [definition!.factory(options ?? {})],
      resolveDataSource: () => ({ kind: 'harvest', id: 'harvest-source' }) as never,
      resolveOAuthClient: () => options
        ? { clientId: options.clientId, clientSecret: options.clientSecret }
        : null,
      fetchImpl,
    })
    const redirectUri = 'https://id.tangle.tools/v1/hub/connections/oauth/callback'
    const started = await provider.startAuth!({
      connectorId: 'harvest',
      owner: { type: 'user', id: 'user_42' },
      requestedScopes: [],
      redirectUri,
      state: 'harvest-state',
      codeChallenge: 'c'.repeat(43),
    })
    const authUrl = new URL(started.authUrl)
    expect(authUrl.origin + authUrl.pathname).toBe('https://id.getharvest.com/oauth2/authorize')
    expect(authUrl.searchParams.get('client_id')).toBe('harvest-client-id')
    expect(authUrl.searchParams.get('state')).toBe('harvest-state')

    const connection = await provider.completeAuth!({
      connectorId: 'harvest',
      owner: { type: 'user', id: 'user_42' },
      code: 'harvest-code',
      state: 'harvest-state',
      redirectUri,
      codeVerifier: 'v'.repeat(64),
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(connection.status).toBe('active')
    expect(connection.grantedScopes).toEqual(['harvest:all'])
  })
})
