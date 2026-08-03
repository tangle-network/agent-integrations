import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  baremetricsConnector,
  checkoutConnector,
  invoiceninjaConnector,
  mollieConnector,
  resolveConnectorAdapterFactoryOptions,
  shopifyConnector,
  squareConnector,
} from '../src/connectors/adapters/index.js'
import type { ConnectorAdapter } from '../src/connectors/types.js'

const customerKeyProviders = [
  checkoutConnector,
  mollieConnector,
  invoiceninjaConnector,
  baremetricsConnector,
] as const

const oauthProviders = [
  [squareConnector, {
    clientId: 'SQUARE_OAUTH_CLIENT_ID',
    clientSecret: 'SQUARE_OAUTH_CLIENT_SECRET',
  }],
  [shopifyConnector, {
    clientId: 'SHOPIFY_OAUTH_CLIENT_ID',
    clientSecret: 'SHOPIFY_OAUTH_CLIENT_SECRET',
  }],
] as const

describe('commerce and payments provider factories', () => {
  it('registers four customer-key providers without shared deployment secrets', () => {
    for (const adapter of customerKeyProviders) {
      const definition = definitionFor(adapter)
      expect(definition.envMap, adapter.manifest.kind).toEqual({})
      expect(resolveConnectorAdapterFactoryOptions(definition, {})).toEqual({})
      expect(definition.factory({}).manifest.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('registers Square and Shopify with their exact shared OAuth settings', () => {
    for (const [adapter, envMap] of oauthProviders) {
      const definition = definitionFor(adapter)
      expect(definition.envMap, adapter.manifest.kind).toEqual(envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition, {
        [envMap.clientId]: 'client-live',
        [envMap.clientSecret]: 'secret-live',
      })).toEqual({ clientId: 'client-live', clientSecret: 'secret-live' })
      expect(definition.factory({}).manifest.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('keeps providers with unsupported credential or enterprise onboarding flows hidden', () => {
    for (const kind of ['pinch-payments']) {
      expect(
        CONNECTOR_ADAPTER_FACTORIES.some((candidate) => candidate.kind === kind),
        kind,
      ).toBe(false)
    }
  })
})

function definitionFor(adapter: ConnectorAdapter) {
  const definition = CONNECTOR_ADAPTER_FACTORIES.find(
    (candidate) => candidate.kind === adapter.manifest.kind,
  )
  expect(definition, adapter.manifest.kind).toBeDefined()
  return definition!
}
