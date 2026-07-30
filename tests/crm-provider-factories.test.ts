import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  pipedriveConnector,
  resolveConnectorAdapterFactoryOptions,
  zohoCrmConnector,
} from '../src/connectors/adapters/index'

describe('CRM provider factory pack', () => {
  it('activates seven executable CRM providers', () => {
    for (const kind of [
      'affinity',
      'attio',
      'pipedrive',
      'close',
      'copper',
      'zoho-crm',
      'microsoft-dynamics-crm',
    ]) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition!.factory({}).manifest.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('fails closed on OAuth apps while API-key CRMs need no app secret', () => {
    for (const kind of ['attio', 'pipedrive', 'close', 'zoho-crm', 'microsoft-dynamics-crm']) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )!
      expect(resolveConnectorAdapterFactoryOptions(definition, {}), kind).toBeNull()
    }
    for (const kind of ['affinity', 'copper']) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )!
      expect(resolveConnectorAdapterFactoryOptions(definition, {}), kind).toEqual({})
    }
  })

  it('requires regional API hosts from Pipedrive and Zoho token responses', () => {
    for (const connector of [pipedriveConnector, zohoCrmConnector]) {
      const auth = connector.manifest.auth
      expect(auth.kind).toBe('oauth2')
      if (auth.kind !== 'oauth2') continue
      expect(auth.tokenMetadata).toEqual({
        apiDomain: { field: 'api_domain', required: true },
      })
    }
  })
})
