import { describe, expect, it } from 'vitest'
import { cryptolensConnector } from '../src/connectors/adapters/cryptolens.js'

describe('cryptolens adapter manifest', () => {
  it('classifies itself as the other category and exposes the cryptolens kind', () => {
    expect(cryptolensConnector.manifest.kind).toBe('cryptolens')
    expect(cryptolensConnector.manifest.category).toBe('other')
    expect(cryptolensConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = cryptolensConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: customer + key lifecycle ops', () => {
    const names = cryptolensConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['customer.add', 'key.block', 'key.create'].sort())
    const mutations = cryptolensConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['customer.add', 'key.block', 'key.create'].sort())
  })
})
