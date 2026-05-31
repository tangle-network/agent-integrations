import { describe, expect, it } from 'vitest'
import { aminosConnector } from '../src/connectors/adapters/aminos.js'

describe('aminos adapter manifest', () => {
  it('classifies itself as other and exposes the aminos kind', () => {
    expect(aminosConnector.manifest.kind).toBe('aminos')
    expect(aminosConnector.manifest.category).toBe('other')
    expect(aminosConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = aminosConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: createUser', () => {
    const names = aminosConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['users.create'])
    const mutations = aminosConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['users.create'])
  })
})
