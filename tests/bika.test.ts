import { describe, expect, it } from 'vitest'
import { bikaConnector } from '../src/connectors/adapters/bika.js'

describe('bika adapter manifest', () => {
  it('classifies itself as the doc category and exposes the bika kind', () => {
    expect(bikaConnector.manifest.kind).toBe('bika')
    expect(bikaConnector.manifest.category).toBe('doc')
    expect(bikaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = bikaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Bika/i)
  })

  it('covers the records capability surface', () => {
    const names = bikaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.create',
        'records.find',
        'records.get',
        'records.update',
        'records.delete',
      ].sort(),
    )
    const mutations = bikaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['records.create', 'records.update', 'records.delete'].sort(),
    )
  })
})
