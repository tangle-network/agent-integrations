import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/index'
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

  it('registers user-supplied task provider credentials without an app secret', () => {
    for (const kind of ['clickup', 'trello']) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition!.envMap, kind).toEqual({})
      expect(resolveConnectorAdapterFactoryOptions(definition!, {}), kind).toEqual({})
    }
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

  it('registers launch and expanded Google providers behind their OAuth application settings', () => {
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
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [envNames[0]]: 'client-id',
      }), kind).toBeNull()
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
})
