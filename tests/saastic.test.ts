import { describe, expect, it } from 'vitest'
import { saasticConnector } from '../src/connectors/adapters/saastic.js'

describe('saastic adapter manifest', () => {
  it('classifies itself as the crm category and exposes the saastic kind', () => {
    expect(saasticConnector.manifest.kind).toBe('saastic')
    expect(saasticConnector.manifest.category).toBe('crm')
    expect(saasticConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = saasticConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Saastic/i)
  })

  it('covers customer and charge capability surfaces', () => {
    const names = saasticConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['customers.create', 'customers.get', 'customers.list', 'charges.create'].sort(),
    )
    const mutations = saasticConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['customers.create', 'charges.create'].sort())
  })
})
