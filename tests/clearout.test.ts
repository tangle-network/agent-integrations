import { describe, expect, it } from 'vitest'
import { clearoutConnector } from '../src/connectors/adapters/clearout.js'

describe('clearout adapter manifest', () => {
  it('classifies itself as the crm category and exposes the clearout kind', () => {
    expect(clearoutConnector.manifest.kind).toBe('clearout')
    expect(clearoutConnector.manifest.category).toBe('crm')
    expect(clearoutConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = clearoutConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: instant email verification', () => {
    const names = clearoutConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['instant.verify'])
    const mutations = clearoutConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['instant.verify'])
  })
})
