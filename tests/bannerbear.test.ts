import { describe, expect, it } from 'vitest'
import { bannerbearConnector } from '../src/connectors/adapters/bannerbear.js'

describe('bannerbear adapter manifest', () => {
  it('classifies itself as the crm category and exposes the bannerbear kind', () => {
    expect(bannerbearConnector.manifest.kind).toBe('bannerbear')
    expect(bannerbearConnector.manifest.category).toBe('crm')
    expect(bannerbearConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = bannerbearConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: creating images', () => {
    const names = bannerbearConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['images.create'])
    const mutations = bannerbearConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['images.create'])
  })
})
