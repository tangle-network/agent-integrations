import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/index.js'

const expectedProviders = {
  'cal-com': ['CALCOM_OAUTH_CLIENT_ID', 'CALCOM_OAUTH_CLIENT_SECRET'],
  savvycal: ['SAVVYCAL_OAUTH_CLIENT_ID', 'SAVVYCAL_OAUTH_CLIENT_SECRET'],
  typeform: ['TYPEFORM_OAUTH_CLIENT_ID', 'TYPEFORM_OAUTH_CLIENT_SECRET'],
  jotform: [],
  tally: [],
  'fillout-forms': [],
  webflow: ['WEBFLOW_OAUTH_CLIENT_ID', 'WEBFLOW_OAUTH_CLIENT_SECRET'],
  wordpress: ['WORDPRESS_OAUTH_CLIENT_ID', 'WORDPRESS_OAUTH_CLIENT_SECRET'],
} as const

describe('scheduling and forms provider factories', () => {
  it('registers every provider with its real deployment requirements', () => {
    for (const [kind, envNames] of Object.entries(expectedProviders)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === kind)
      expect(definition, kind).toBeDefined()
      expect(Object.values(definition!.envMap), kind).toEqual(envNames)
      expect(definition!.factory({}).manifest.capabilities.length, kind).toBeGreaterThan(0)
    }
  })

  it('fails closed for OAuth apps but allows customer-supplied API keys', () => {
    for (const [kind, envNames] of Object.entries(expectedProviders)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === kind)!
      if (envNames.length === 0) {
        expect(resolveConnectorAdapterFactoryOptions(definition, {}), kind).toEqual({})
        continue
      }
      expect(resolveConnectorAdapterFactoryOptions(definition, {
        [envNames[0]]: 'configured-client-id',
      }), kind).toBeNull()
    }
  })
})
