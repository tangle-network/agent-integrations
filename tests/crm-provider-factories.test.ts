import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  pipedriveConnector,
  resolveConnectorAdapterFactoryOptions,
  zohoCrmConnector,
} from '../src/connectors/adapters/index'

describe('CRM provider factory pack', () => {
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
