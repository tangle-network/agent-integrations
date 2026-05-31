import { describe, expect, it } from 'vitest'
import { whatConvertsConnector } from '../src/connectors/adapters/what-converts.js'

describe('what-converts adapter manifest', () => {
  it('classifies itself as the crm category and exposes the what-converts kind', () => {
    expect(whatConvertsConnector.manifest.kind).toBe('what-converts')
    expect(whatConvertsConnector.manifest.category).toBe('crm')
    expect(whatConvertsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = whatConvertsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: leads.list, leads.getByEmail, leads.create, leads.update', () => {
    const names = whatConvertsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['leads.create', 'leads.getByEmail', 'leads.list', 'leads.update'])
    const mutations = whatConvertsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['leads.create', 'leads.update'])
  })
})
