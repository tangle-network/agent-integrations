import { describe, expect, it } from 'vitest'
import { azureCommunicationServicesConnector } from '../src/connectors/adapters/azure-communication-services.js'

describe('azure-communication-services adapter manifest', () => {
  it('classifies itself as the comms category and exposes the azure-communication-services kind', () => {
    expect(azureCommunicationServicesConnector.manifest.kind).toBe('azure-communication-services')
    expect(azureCommunicationServicesConnector.manifest.category).toBe('comms')
    expect(azureCommunicationServicesConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = azureCommunicationServicesConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: send.email', () => {
    const names = azureCommunicationServicesConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['send.email'])
    const mutations = azureCommunicationServicesConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['send.email'])
  })
})
