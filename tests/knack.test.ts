import { describe, expect, it } from 'vitest'
import { knackConnector } from '../src/connectors/adapters/knack.js'

describe('knack adapter manifest', () => {
  it('classifies itself as the storage category and exposes the knack kind', () => {
    expect(knackConnector.manifest.kind).toBe('knack')
    expect(knackConnector.manifest.category).toBe('storage')
    expect(knackConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = knackConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: record CRUD against Knack objects', () => {
    const names = knackConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['records.create', 'records.delete', 'records.find', 'records.update'].sort(),
    )
    const reads = knackConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = knackConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.find'])
    expect(mutations).toEqual(
      ['records.create', 'records.delete', 'records.update'].sort(),
    )
  })
})
