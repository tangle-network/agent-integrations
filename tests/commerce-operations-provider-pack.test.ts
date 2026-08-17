import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  billplzConnector,
  cashfreePaymentsConnector,
  lemonSqueezyConnector,
  resolveConnectorAdapterFactoryOptions,
  saleorConnector,
  shippoConnector,
  voucheryIoConnector,
} from '../src/connectors/adapters/index.js'

const expectedProviders = [
  lemonSqueezyConnector,
  shippoConnector,
  billplzConnector,
  voucheryIoConnector,
  saleorConnector,
  cashfreePaymentsConnector,
] as const

describe('commerce operations provider factories', () => {
  it('registers six customer-credential adapters without deployment secrets', () => {
    for (const adapter of expectedProviders) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === adapter.manifest.kind,
      )
      expect(definition, adapter.manifest.kind).toBeDefined()
      expect(definition!.envMap, adapter.manifest.kind).toEqual({})
      expect(resolveConnectorAdapterFactoryOptions(definition!, {})).toEqual({})
      expect(definition!.factory({}).manifest.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('keeps providers with incomplete auth flows hidden', () => {
    for (const kind of [
      'woocommerce',
      'just-invoice',
      'quickzu',
      'simpliroute',
    ]) {
      expect(
        CONNECTOR_ADAPTER_FACTORIES.some((candidate) => candidate.kind === kind),
        kind,
      ).toBe(false)
    }
  })
})
