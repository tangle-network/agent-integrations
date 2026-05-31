import { describe, expect, it } from 'vitest'
import { certopusConnector } from '../src/connectors/adapters/certopus.js'

describe('certopus adapter manifest', () => {
  it('exposes the certopus kind and other category', () => {
    expect(certopusConnector.manifest.kind).toBe('certopus')
    expect(certopusConnector.manifest.category).toBe('other')
    expect(certopusConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = certopusConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action: credentials.create plus discovery reads', () => {
    const names = certopusConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['categories.list', 'credentials.create', 'events.list', 'organisations.list'].sort(),
    )
    const reads = certopusConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = certopusConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['categories.list', 'events.list', 'organisations.list'])
    expect(mutations).toEqual(['credentials.create'])
  })
})
