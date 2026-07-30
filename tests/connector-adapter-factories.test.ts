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

  it('registers launch providers behind their OAuth application settings', () => {
    const expected = {
      salesforce: ['SALESFORCE_OAUTH_CLIENT_ID', 'SALESFORCE_OAUTH_CLIENT_SECRET'],
      dropbox: ['DROPBOX_OAUTH_CLIENT_ID', 'DROPBOX_OAUTH_CLIENT_SECRET'],
      box: ['BOX_OAUTH_CLIENT_ID', 'BOX_OAUTH_CLIENT_SECRET'],
      zoom: ['ZOOM_OAUTH_CLIENT_ID', 'ZOOM_OAUTH_CLIENT_SECRET'],
      calendly: ['CALENDLY_OAUTH_CLIENT_ID', 'CALENDLY_OAUTH_CLIENT_SECRET'],
      asana: ['ASANA_OAUTH_CLIENT_ID', 'ASANA_OAUTH_CLIENT_SECRET'],
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
})
