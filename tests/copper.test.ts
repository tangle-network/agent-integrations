import { describe, expect, it } from 'vitest'
import { copperConnector } from '../src/connectors/adapters/copper.js'

describe('copper adapter manifest', () => {
  it('classifies itself as the crm category and exposes the copper kind', () => {
    expect(copperConnector.manifest.kind).toBe('copper')
    expect(copperConnector.manifest.category).toBe('crm')
    expect(copperConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = copperConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (people/leads/companies/opportunities/projects/tasks/activities + searches)', () => {
    const names = copperConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'create.person',
        'update.person',
        'create.lead',
        'update.lead',
        'convert.lead',
        'create.company',
        'update.company',
        'create.opportunity',
        'update.opportunity',
        'create.project',
        'update.project',
        'create.task',
        'create.activity',
        'search.for.an.activity',
        'search.for.aperson',
        'search.for.alead',
        'search.for.acompany',
        'search.for.an.opportunity',
        'search.for.aproject',
      ].sort(),
    )
    const reads = copperConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = copperConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'search.for.an.activity',
        'search.for.aperson',
        'search.for.alead',
        'search.for.acompany',
        'search.for.an.opportunity',
        'search.for.aproject',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'create.person',
        'update.person',
        'create.lead',
        'update.lead',
        'convert.lead',
        'create.company',
        'update.company',
        'create.opportunity',
        'update.opportunity',
        'create.project',
        'update.project',
        'create.task',
        'create.activity',
      ].sort(),
    )
  })
})
