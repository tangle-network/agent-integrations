import { describe, expect, it } from 'vitest'
import { tableauConnector } from '../src/connectors/adapters/tableau.js'

describe('tableau adapter manifest', () => {
  it('classifies itself as the database category and exposes the tableau kind', () => {
    expect(tableauConnector.manifest.kind).toBe('tableau')
    expect(tableauConnector.manifest.category).toBe('database')
    expect(tableauConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = tableauConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Tableau/i)
  })

  it('covers the views, workbooks, extracts, and datasources capability surface', () => {
    const names = tableauConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'datasources.query',
        'extracts.refresh',
        'views.download',
        'views.find',
        'workbooks.find',
        'workbooks.refresh',
      ].sort(),
    )
  })

  it('includes read and mutation operations', () => {
    const reads = tableauConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['datasources.query', 'views.download', 'views.find', 'workbooks.find'].sort())

    const mutations = tableauConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['extracts.refresh', 'workbooks.refresh'].sort())
  })
})
