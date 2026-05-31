import { describe, expect, it } from 'vitest'
import { aircallConnector } from '../src/connectors/adapters/aircall.js'

describe('aircall adapter manifest', () => {
  it('classifies itself as the comms category and exposes the aircall kind', () => {
    expect(aircallConnector.manifest.kind).toBe('aircall')
    expect(aircallConnector.manifest.category).toBe('comms')
    expect(aircallConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = aircallConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: call lookup/comment/tag and contact CRUD', () => {
    const names = aircallConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'calls.find',
        'calls.get',
        'calls.comment',
        'calls.tag',
        'contacts.find',
        'contacts.create',
        'contacts.update',
      ].sort(),
    )
    const reads = aircallConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = aircallConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['calls.find', 'calls.get', 'contacts.find'])
    expect(mutations).toEqual(
      ['calls.comment', 'calls.tag', 'contacts.create', 'contacts.update'].sort(),
    )
  })
})
