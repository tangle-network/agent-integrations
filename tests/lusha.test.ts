import { describe, expect, it } from 'vitest'
import { lushaConnector } from '../src/connectors/adapters/lusha.js'

describe('lusha adapter manifest', () => {
  it('exposes the lusha kind and a UI-groupable category', () => {
    expect(lushaConnector.manifest.kind).toBe('lusha')
    expect(lushaConnector.manifest.category).toBe('other')
    expect(lushaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = lushaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces actions (search.companies, enrich.companies) plus the natural contact counterparts', () => {
    const names = lushaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'search.companies',
        'enrich.companies',
        'search.contacts',
        'enrich.contacts',
        'lists.create',
        'lists.add',
        'lists.delete',
      ].sort(),
    )

    const reads = lushaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = lushaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(['search.companies', 'search.contacts'].sort())
    expect(mutations).toEqual(
      ['enrich.companies', 'enrich.contacts', 'lists.create', 'lists.add', 'lists.delete'].sort(),
    )
  })
})
